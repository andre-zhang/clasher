import type { ScheduleDraftSlot } from "@/lib/api";

/** If the whole string is uppercase (with letters), convert to Title Case words. */
export function normalizeImportedText(s: string): string {
  const t = s.trim();
  if (!t) return t;
  if (!/[A-Za-z]/.test(t)) return t;
  if (t !== t.toUpperCase()) return t;
  return t
    .toLowerCase()
    .split(/(\s+)/)
    .map((part) =>
      /^\s+$/.test(part)
        ? part
        : part.replace(/^[a-z]/, (c) => c.toUpperCase())
    )
    .join("");
}

export function normalizeImportedArtistNames(names: string[]): string[] {
  return names.map((n) => normalizeImportedText(n));
}

export function normalizeImportedScheduleSlots(
  slots: ScheduleDraftSlot[]
): ScheduleDraftSlot[] {
  return slots.map((s) => ({
    dayLabel: normalizeImportedText(s.dayLabel),
    stageName: normalizeImportedText(s.stageName),
    start: s.start.trim(),
    end: s.end.trim(),
    artistName: normalizeImportedText(s.artistName),
  }));
}
