/** Parse "HH:mm" or "H:mm" to minutes from midnight. */
export function parseHm(s: string): number {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

/** Like parseHm but allows single-digit minutes (e.g. 14:5) and normalizes unicode dashes. */
export function parseHmRelaxed(s: string): number {
  const t = s.trim().replace(/[–—]/g, "-");
  const m = t.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return NaN;
  const h = parseInt(m[1]!, 10);
  const mi = parseInt(m[2]!, 10);
  if (mi < 0 || mi > 59 || h < 0 || h > 30) return NaN;
  return h * 60 + mi;
}

export function hhmmFromMinutes(total: number): string {
  let t = Math.round(total);
  if (!Number.isFinite(t)) t = 0;
  // Avoid negative modulo (invalid for parseHm) while dragging.
  t = Math.max(0, t);
  const h = Math.floor(t / 60);
  const mi = t % 60;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

/** Timeline row spacing in the schedule grid (minutes). */
export const CALENDAR_TIME_STEP_MINUTES = 15;

/** Plan strip / dialog: snap planFrom and planTo to this grid (minutes). */
export const PLAN_WINDOW_SNAP_MINUTES = 5;

/** Smallest plan window when the slot is long enough (minutes). */
export const PLAN_WINDOW_MIN_DURATION_MINUTES = 10;

export function snapPlanWindowMinutes(m: number): number {
  const s = PLAN_WINDOW_SNAP_MINUTES;
  return Math.round(m / s) * s;
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

/**
 * Priority split: first gets their full listed window; second gets the non-overlapping
 * remainder of their window (tail after first ends, or head before first starts).
 * Same day only; different days → both keep full windows.
 */
export function splitPriorityWindows(
  first: { dayLabel: string; start: string; end: string },
  second: { dayLabel: string; start: string; end: string }
): { first: { from: string; to: string }; second: { from: string; to: string } } {
  if (first.dayLabel.trim().toLowerCase() !== second.dayLabel.trim().toLowerCase()) {
    return {
      first: { from: first.start, to: first.end },
      second: { from: second.start, to: second.end },
    };
  }
  const fs = parseHm(first.start);
  const fe = parseHm(first.end);
  const ss = parseHm(second.start);
  const se = parseHm(second.end);
  if ([fs, fe, ss, se].some(Number.isNaN)) {
    return {
      first: { from: first.start, to: first.end },
      second: { from: second.start, to: second.end },
    };
  }
  const firstWin = { from: first.start, to: first.end };
  if (fe <= ss || se <= fs) {
    return {
      first: firstWin,
      second: { from: second.start, to: second.end },
    };
  }
  let s0: number;
  let s1: number;
  if (fs <= ss) {
    s0 = Math.max(ss, fe);
    s1 = se;
  } else {
    s0 = ss;
    s1 = Math.min(se, fs);
  }
  if (s0 >= s1) {
    return {
      first: firstWin,
      second: { from: second.start, to: second.start },
    };
  }
  return {
    first: firstWin,
    second: { from: hhmmFromMinutes(s0), to: hhmmFromMinutes(s1) },
  };
}
