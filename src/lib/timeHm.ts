/** Wall clock: festival “day” for UI and same-day logic starts at 1 PM. */
export const FESTIVAL_DAY_START_WALL_MINUTES = 13 * 60;

/**
 * Linear position on the festival day: 13:00 → 0, 23:59 → 659, 00:00 → 660, 12:59 → 1439.
 * Use for sorting, overlap, and calendar Y positions (same calendar `dayLabel`).
 */
export function wallMinutesToFestivalTimeline(m: number): number {
  if (!Number.isFinite(m) || Number.isNaN(m)) return NaN;
  let x = Math.round(m) % 1440;
  if (x < 0) x += 1440;
  if (x >= FESTIVAL_DAY_START_WALL_MINUTES) {
    return x - FESTIVAL_DAY_START_WALL_MINUTES;
  }
  return x + (1440 - FESTIVAL_DAY_START_WALL_MINUTES);
}

/** Inverse of {@link wallMinutesToFestivalTimeline} for tick labels and stored HH:mm. */
export function festivalTimelineToWallMinutes(fm: number): number {
  if (!Number.isFinite(fm) || Number.isNaN(fm)) return NaN;
  let x = Math.round(fm);
  if (x < 0) x = 0;
  if (x > 1439) x = 1439;
  const afternoonSpan = 1440 - FESTIVAL_DAY_START_WALL_MINUTES;
  if (x < afternoonSpan) {
    return x + FESTIVAL_DAY_START_WALL_MINUTES;
  }
  return x - afternoonSpan;
}

/** Parse "HH:mm" then map to festival timeline minutes (1 PM origin). */
export function parseHmToFestivalM(s: string): number {
  return wallMinutesToFestivalTimeline(parseHm(s));
}

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

/** Tick label: festival coordinate → wall clock string. */
export function formatFestivalTickHm(festM: number): string {
  const w = festivalTimelineToWallMinutes(festM);
  if (Number.isNaN(w)) return "—";
  return hhmmFromMinutes(w);
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
    const as = wallMinutesToFestivalTimeline(parseHm(a.start));
    const be = wallMinutesToFestivalTimeline(parseHm(b.end));
    if (!Number.isNaN(as) && !Number.isNaN(be)) {
      return Math.floor((as + be) / 2);
    }
    return 0;
  }
  const as = wallMinutesToFestivalTimeline(parseHm(a.start));
  const ae = wallMinutesToFestivalTimeline(parseHm(a.end));
  const bs = wallMinutesToFestivalTimeline(parseHm(b.start));
  const be = wallMinutesToFestivalTimeline(parseHm(b.end));
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
  const fs = wallMinutesToFestivalTimeline(parseHm(first.start));
  const fe = wallMinutesToFestivalTimeline(parseHm(first.end));
  const ss = wallMinutesToFestivalTimeline(parseHm(second.start));
  const se = wallMinutesToFestivalTimeline(parseHm(second.end));
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
    second: {
      from: hhmmFromMinutes(festivalTimelineToWallMinutes(s0)),
      to: hhmmFromMinutes(festivalTimelineToWallMinutes(s1)),
    },
  };
}
