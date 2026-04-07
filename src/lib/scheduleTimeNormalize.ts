import type { ScheduleDraftSlot } from "@/lib/api";

/**
 * Single day: first ambiguous use of clock hour 1–12 → PM; second → AM; alternates.
 * Explicit am/pm and hour ≥ 13 (24h) are left as-is (after normalization).
 */
function normalizeOneTime(
  raw: string,
  dayKey: string,
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

  let hour = parseInt(hm[1]!, 10);
  const minute = hm[2] ? parseInt(hm[2], 10) : 0;
  if (minute < 0 || minute > 59) return s;

  if (hour >= 13 && hour <= 23) {
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  if (hour === 0) {
    return `00:${String(minute).padStart(2, "0")}`;
  }
  if (hour < 1 || hour > 12) return s;

  const key = `${dayKey}\0${hour}`;
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

/** Apply PM-first ambiguous rules to parsed timetable rows (order preserved). */
export function normalizeScheduleTimesForImport(
  slots: ScheduleDraftSlot[]
): ScheduleDraftSlot[] {
  const ambiguousCount = new Map<string, number>();
  return slots.map((slot) => {
    const dayKey = slot.dayLabel.trim() || "?";
    return {
      ...slot,
      start: normalizeOneTime(slot.start, dayKey, ambiguousCount),
      end: normalizeOneTime(slot.end, dayKey, ambiguousCount),
    };
  });
}
