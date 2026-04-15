import type { FestivalSnapshot } from "@/lib/types";
import {
  festivalTimelineToWallMinutes,
  hhmmFromMinutes,
  parseHm,
  wallMinutesToFestivalTimeline,
} from "@/lib/timeHm";
import { walkMinutesBetweenStages } from "@/lib/walkFeasibility";

/**
 * Next slot in plan strip: full listed window for first item; later items start
 * after previous plan end + walk (when walk times on and stages differ).
 */
export function defaultPlanWindowAfterPrevious(
  group: FestivalSnapshot,
  slot: FestivalSnapshot["schedule"][0],
  previous: {
    slot: FestivalSnapshot["schedule"][0];
    planFrom: string;
    planTo: string;
  } | null
): { planFrom: string; planTo: string } {
  const lo = wallMinutesToFestivalTimeline(parseHm(slot.start));
  const hi = wallMinutesToFestivalTimeline(parseHm(slot.end));
  if (Number.isNaN(lo) || Number.isNaN(hi)) {
    return { planFrom: slot.start, planTo: slot.end };
  }
  if (!previous) {
    return {
      planFrom: hhmmFromMinutes(festivalTimelineToWallMinutes(lo)),
      planTo: hhmmFromMinutes(festivalTimelineToWallMinutes(hi)),
    };
  }
  const prevEnd = wallMinutesToFestivalTimeline(parseHm(previous.planTo));
  if (Number.isNaN(prevEnd)) {
    return {
      planFrom: hhmmFromMinutes(festivalTimelineToWallMinutes(lo)),
      planTo: hhmmFromMinutes(festivalTimelineToWallMinutes(hi)),
    };
  }
  const walk = group.walkTimesEnabled
    ? walkMinutesBetweenStages(
        group,
        previous.slot.stageName,
        slot.stageName
      )
    : 0;
  const earliest = prevEnd + walk;
  let fromM = Math.max(lo, earliest);
  if (fromM >= hi) {
    fromM = lo;
  }
  return {
    planFrom: hhmmFromMinutes(festivalTimelineToWallMinutes(fromM)),
    planTo: hhmmFromMinutes(festivalTimelineToWallMinutes(hi)),
  };
}

export function recomputeStripWindowsSequential(
  group: FestivalSnapshot,
  stripIds: string[],
  schedule: FestivalSnapshot["schedule"]
): Record<string, { planFrom: string; planTo: string }> {
  const byId = new Map(schedule.map((s) => [s.id, s]));
  const out: Record<string, { planFrom: string; planTo: string }> = {};
  let prev: {
    slot: FestivalSnapshot["schedule"][0];
    planFrom: string;
    planTo: string;
  } | null = null;
  for (const id of stripIds) {
    const slot = byId.get(id);
    if (!slot) continue;
    out[id] = defaultPlanWindowAfterPrevious(group, slot, prev);
    prev = { slot, planFrom: out[id]!.planFrom, planTo: out[id]!.planTo };
  }
  return out;
}
