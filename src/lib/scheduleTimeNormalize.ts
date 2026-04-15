import type { ScheduleDraftSlot } from "@/lib/api";
import { hhmmFromMinutes, parseHm } from "@/lib/timeHm";

/**
 * Single day + stage: first ambiguous use of clock hour 1–11 → PM; second → AM; alternates.
 * Ambiguous **12** (no am/pm) is always **midnight** (00:xx), not noon — festival days run into the night.
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

  if (hour === 12) {
    return `00:${String(minute).padStart(2, "0")}`;
  }

  const key = `${scopePrefix}\0${hour}`;
  const n = (ambiguousCount.get(key) ?? 0) + 1;
  ambiguousCount.set(key, n);
  const usePm = n % 2 === 1;
  const h24 = usePm ? hour + 12 : hour;
  return `${String(h24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Acts from 00:00–00:59 belong to the **previous** festival day (e.g. “Sunday 12:55am” OCR → Sunday + 12:55
 * becomes 00:55 → move to Saturday). Only start time is used; nothing is expected past 00:59.
 */
function adjustLateNightDayLabels(slots: ScheduleDraftSlot[]): ScheduleDraftSlot[] {
  const orderedDays: string[] = [];
  const seen = new Set<string>();
  for (const s of slots) {
    const d = s.dayLabel.trim();
    if (!d || seen.has(d)) continue;
    seen.add(d);
    orderedDays.push(d);
  }
  return slots.map((slot) => {
    const startM = parseHm(slot.start);
    if (Number.isNaN(startM) || startM >= 60) return slot;
    const d = slot.dayLabel.trim();
    if (!d) return slot;
    const idx = orderedDays.indexOf(d);
    if (idx <= 0) return slot;
    return { ...slot, dayLabel: orderedDays[idx - 1]! };
  });
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

/**
 * Misread start as early AM when the set is really afternoon (e.g. 02:00–14:25 → 14:00–14:25).
 * If end is clearly PM, start is before noon, and the span is unrealistically long, shift start +12h
 * when that yields a plausible duration.
 */
function fixMisreadMorningStart(start: string, end: string): string {
  const sm = parseHm(start);
  const em = parseHm(end);
  if (Number.isNaN(sm) || Number.isNaN(em) || em < 12 * 60 || sm >= 12 * 60)
    return start;
  if (em <= sm) return start;
  const dur = em - sm;
  if (dur <= 5 * 60) return start;
  const sm2 = sm + 12 * 60;
  if (sm2 >= em) return start;
  const dur2 = em - sm2;
  if (dur2 > 8 * 60) return start;
  return hhmmFromMinutes(sm2);
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
  const fixed = normalized.map((slot) => {
    const end = fixMisreadAfternoonEnd(slot.start, slot.end);
    const start = fixMisreadMorningStart(slot.start, end);
    return { ...slot, start, end };
  });
  return adjustLateNightDayLabels(fixed);
}
