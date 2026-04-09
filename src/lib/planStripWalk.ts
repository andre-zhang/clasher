import type { FestivalSnapshot } from "@/lib/types";
import { hhmmFromMinutes, parseHm } from "@/lib/timeHm";
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
  const lo = parseHm(slot.start);
  const hi = parseHm(slot.end);
  if (Number.isNaN(lo) || Number.isNaN(hi)) {
    return { planFrom: slot.start, planTo: slot.end };
  }
  if (!previous) {
    return { planFrom: hhmmFromMinutes(lo), planTo: hhmmFromMinutes(hi) };
  }
  const prevEnd = parseHm(previous.planTo);
  if (Number.isNaN(prevEnd)) {
    return { planFrom: hhmmFromMinutes(lo), planTo: hhmmFromMinutes(hi) };
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
    planFrom: hhmmFromMinutes(fromM),
    planTo: hhmmFromMinutes(hi),
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
