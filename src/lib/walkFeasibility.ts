import {
  effectiveMemberSlotPlanWindow,
  effectiveMemberWantsSlot,
} from "@/lib/effectiveIntents";
import type { FestivalSnapshot } from "@/lib/types";
import {
  festivalTimelineToWallMinutes,
  hhmmFromMinutes,
  parseHm,
  wallMinutesToFestivalTimeline,
} from "@/lib/timeHm";

export type MinuteWindow = {
  dayKey: string;
  stageName: string;
  startM: number;
  endM: number;
};

/** When walk times are on but the matrix has no entry for a stage pair, use this gap (minutes). */
export const DEFAULT_INTER_STAGE_WALK_MINUTES = 5;

/** Upper bound for any inter-stage walk (matrix, default, or inferred). */
export const MAX_WALK_MINUTES_BETWEEN_STAGES = 10;

export function walkMinutesBetweenStages(
  group: FestivalSnapshot,
  stageA: string,
  stageB: string
): number {
  const a = stageA.trim();
  const b = stageB.trim();
  if (a === b) return 0;
  if (!group.walkTimesEnabled) return 0;
  let raw = DEFAULT_INTER_STAGE_WALK_MINUTES;
  const m = group.walkMatrix;
  if (m) {
    const ab = m[a]?.[b];
    if (typeof ab === "number" && Number.isFinite(ab)) raw = ab;
    else {
      const ba = m[b]?.[a];
      if (typeof ba === "number" && Number.isFinite(ba)) raw = ba;
    }
  }
  return Math.min(
    MAX_WALK_MINUTES_BETWEEN_STAGES,
    Math.max(0, Math.round(raw))
  );
}

function windowInfeasibleTogether(
  group: FestivalSnapshot,
  a: MinuteWindow,
  b: MinuteWindow
): boolean {
  if (a.dayKey !== b.dayKey) return false;
  const as = a.startM;
  const ae = a.endM;
  const bs = b.startM;
  const be = b.endM;
  if ([as, ae, bs, be].some(Number.isNaN)) return false;
  if (as < be && bs < ae) return true;
  if (ae <= bs) {
    const w = walkMinutesBetweenStages(group, a.stageName, b.stageName);
    return ae + w > bs;
  }
  if (be <= as) {
    const w = walkMinutesBetweenStages(group, b.stageName, a.stageName);
    return be + w > as;
  }
  return true;
}

/** True if one person cannot attend both full slots (overlap or insufficient travel gap). */
export function slotsInfeasibleTogether(
  group: FestivalSnapshot,
  a: FestivalSnapshot["schedule"][0],
  b: FestivalSnapshot["schedule"][0]
): boolean {
  const dk = (s: FestivalSnapshot["schedule"][0]) =>
    s.dayLabel.trim().toLowerCase();
  return windowInfeasibleTogether(
    group,
    {
      dayKey: dk(a),
      stageName: a.stageName,
      startM: wallMinutesToFestivalTimeline(parseHm(a.start)),
      endM: wallMinutesToFestivalTimeline(parseHm(a.end)),
    },
    {
      dayKey: dk(b),
      stageName: b.stageName,
      startM: wallMinutesToFestivalTimeline(parseHm(b.start)),
      endM: wallMinutesToFestivalTimeline(parseHm(b.end)),
    }
  );
}

/** Plan strip: custom from/to per slot id (HH:mm), clamped to slot bounds by caller. */
export function stripWindowsInfeasiblePair(
  group: FestivalSnapshot,
  orderedSlots: FestivalSnapshot["schedule"][number][],
  windows: Record<string, { planFrom: string; planTo: string }>,
  allowClashes: boolean
): { a: string; b: string } | null {
  if (allowClashes) return null;
  const minsFor = (s: FestivalSnapshot["schedule"][0]): MinuteWindow => {
    const w = windows[s.id];
    const rawS = w?.planFrom ?? s.start;
    const rawE = w?.planTo ?? s.end;
    let sm = wallMinutesToFestivalTimeline(parseHm(rawS));
    let em = wallMinutesToFestivalTimeline(parseHm(rawE));
    const lo = wallMinutesToFestivalTimeline(parseHm(s.start));
    const hi = wallMinutesToFestivalTimeline(parseHm(s.end));
    if (!Number.isNaN(lo) && !Number.isNaN(hi)) {
      if (!Number.isNaN(sm)) sm = Math.max(lo, Math.min(hi, sm));
      if (!Number.isNaN(em)) em = Math.max(lo, Math.min(hi, em));
    }
    if (!Number.isNaN(sm) && !Number.isNaN(em) && em < sm) {
      em = sm;
    }
    return {
      dayKey: s.dayLabel.trim().toLowerCase(),
      stageName: s.stageName,
      startM: sm,
      endM: em,
    };
  };
  for (let i = 0; i < orderedSlots.length; i++) {
    for (let j = i + 1; j < orderedSlots.length; j++) {
      const a = orderedSlots[i]!;
      const b = orderedSlots[j]!;
      if (windowInfeasibleTogether(group, minsFor(a), minsFor(b))) {
        return { a: a.id, b: b.id };
      }
    }
  }
  return null;
}

export function clampPlanWindowToSlot(
  slot: FestivalSnapshot["schedule"][0],
  planFrom: string,
  planTo: string
): { planFrom: string; planTo: string } {
  const lo = wallMinutesToFestivalTimeline(parseHm(slot.start));
  const hi = wallMinutesToFestivalTimeline(parseHm(slot.end));
  let sm = wallMinutesToFestivalTimeline(parseHm(planFrom));
  let em = wallMinutesToFestivalTimeline(parseHm(planTo));
  if (Number.isNaN(sm) || Number.isNaN(em)) {
    return { planFrom: slot.start, planTo: slot.end };
  }
  if (!Number.isNaN(lo) && !Number.isNaN(hi)) {
    sm = Math.max(lo, Math.min(hi, sm));
    em = Math.max(lo, Math.min(hi, em));
  }
  if (em < sm) em = sm;
  return {
    planFrom: hhmmFromMinutes(festivalTimelineToWallMinutes(sm)),
    planTo: hhmmFromMinutes(festivalTimelineToWallMinutes(em)),
  };
}

function minuteWindowFromMemberEffectivePlan(
  group: FestivalSnapshot,
  memberId: string,
  s: FestivalSnapshot["schedule"][0]
): MinuteWindow {
  const dk = s.dayLabel.trim().toLowerCase();
  const w = effectiveMemberSlotPlanWindow(group, memberId, s);
  const rawS = w.planFrom ?? s.start;
  const rawE = w.planTo ?? s.end;
  let sm = wallMinutesToFestivalTimeline(parseHm(rawS));
  let em = wallMinutesToFestivalTimeline(parseHm(rawE));
  const lo = wallMinutesToFestivalTimeline(parseHm(s.start));
  const hi = wallMinutesToFestivalTimeline(parseHm(s.end));
  if (!Number.isNaN(lo) && !Number.isNaN(hi)) {
    if (!Number.isNaN(sm)) sm = Math.max(lo, Math.min(hi, sm));
    if (!Number.isNaN(em)) em = Math.max(lo, Math.min(hi, em));
  }
  if (!Number.isNaN(sm) && !Number.isNaN(em) && em < sm) em = sm;
  return {
    dayKey: dk,
    stageName: s.stageName.trim(),
    startM: sm,
    endM: em,
  };
}

/** True if this member’s effective plan windows for both slots cannot both be attended. */
export function memberEffectivePlanWindowsInfeasibleTogether(
  group: FestivalSnapshot,
  memberId: string,
  a: FestivalSnapshot["schedule"][0],
  b: FestivalSnapshot["schedule"][0]
): boolean {
  if (
    !effectiveMemberWantsSlot(group, memberId, a.id) ||
    !effectiveMemberWantsSlot(group, memberId, b.id)
  ) {
    return false;
  }
  return windowInfeasibleTogether(
    group,
    minuteWindowFromMemberEffectivePlan(group, memberId, a),
    minuteWindowFromMemberEffectivePlan(group, memberId, b)
  );
}
