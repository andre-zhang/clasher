import type { ScheduleDraftSlot } from "@/lib/api";
import { hhmmFromMinutes, parseHm } from "@/lib/timeHm";

/**
 * Single day + stage: first ambiguous use of clock hour 1–12 → PM; second → AM; alternates.
 * Scoped per stage so two stages don’t “steal” AM/PM from each other.
 * Explicit am/pm and hour ≥ 13 (24h) are left as-is (after normalization).
 */
function normalizeOneTime(
  raw: string,
  scopePrefix: string,
  ambiguousCount: Map<string, number>
): string {
  const s = raw.trim();
  if (!s) return s;

  const ampm = s.match(
    /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)$/i
  );
  if (ampm) {
    let h = parseInt(ampm[1]!, 10);
    const mi = ampm[2] ? parseInt(ampm[2], 10) : 0;
    const pm = /^p/i.test(ampm[3]!);
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }

  const hm = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!hm) return s;

  const hour = parseInt(hm[1]!, 10);
  const minute = hm[2] ? parseInt(hm[2], 10) : 0;
  if (minute < 0 || minute > 59) return s;

  if (hour >= 13 && hour <= 23) {
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  if (hour === 0) {
    return `00:${String(minute).padStart(2, "0")}`;
  }
  if (hour < 1 || hour > 12) return s;

  const key = `${scopePrefix}\0${hour}`;
  const n = (ambiguousCount.get(key) ?? 0) + 1;
  ambiguousCount.set(key, n);
  const usePm = n % 2 === 1;

  if (hour === 12) {
    const h24 = usePm ? 12 : 0;
    return `${String(h24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const h24 = usePm ? hour + 12 : hour;
  return `${String(h24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * OCR / paste typo: "13:00–1:30" read as 13:00–01:30 (next day) when it meant 13:30.
 * If end is before start, start is noon+, and adding 12h to end fixes order with a plausible duration, apply it.
 * Does not infer multi-day wraps (e.g. 23:00 → 00:30) from cross-stage conflicts.
 */
function fixMisreadAfternoonEnd(start: string, end: string): string {
  const sm = parseHm(start);
  const em = parseHm(end);
  if (Number.isNaN(sm) || Number.isNaN(em) || em >= sm) return end;
  if (sm < 12 * 60 || em >= 12 * 60) return end;
  const em2 = em + 12 * 60;
  if (em2 <= sm) return end;
  const dur = em2 - sm;
  if (dur > 8 * 60) return end;
  return hhmmFromMinutes(em2);
}

/** Apply PM-first ambiguous rules to parsed timetable rows (order preserved). */
export function normalizeScheduleTimesForImport(
  slots: ScheduleDraftSlot[]
): ScheduleDraftSlot[] {
  const ambiguousCount = new Map<string, number>();
  const normalized = slots.map((slot) => {
    const dayKey = slot.dayLabel.trim() || "?";
    const stageKey = slot.stageName.trim() || "?";
    const scopePrefix = `${dayKey}\0${stageKey}`;
    return {
      ...slot,
      start: normalizeOneTime(slot.start, scopePrefix, ambiguousCount),
      end: normalizeOneTime(slot.end, scopePrefix, ambiguousCount),
    };
  });
  return normalized.map((slot) => ({
    ...slot,
    end: fixMisreadAfternoonEnd(slot.start, slot.end),
  }));
}
