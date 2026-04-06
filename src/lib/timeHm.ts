/** Parse "HH:mm" or "H:mm" to minutes from midnight. */
export function parseHm(s: string): number {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

export function hhmmFromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const mi = total % 60;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

/** Midpoint of time overlap on the same day; falls back to average of outer bounds. */
export function splitSwitchMinutes(
  a: { dayLabel: string; start: string; end: string },
  b: { dayLabel: string; start: string; end: string }
): number {
  if (a.dayLabel.trim().toLowerCase() !== b.dayLabel.trim().toLowerCase()) {
    const as = parseHm(a.start);
    const be = parseHm(b.end);
    if (!Number.isNaN(as) && !Number.isNaN(be)) {
      return Math.floor((as + be) / 2);
    }
    return 0;
  }
  const as = parseHm(a.start);
  const ae = parseHm(a.end);
  const bs = parseHm(b.start);
  const be = parseHm(b.end);
  if ([as, ae, bs, be].some(Number.isNaN)) return 0;
  const oStart = Math.max(as, bs);
  const oEnd = Math.min(ae, be);
  if (oStart < oEnd) return Math.floor((oStart + oEnd) / 2);
  return Math.floor((Math.min(as, bs) + Math.max(ae, be)) / 2);
}
