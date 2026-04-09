import { parseHm } from "@/lib/timeHm";
import { walkMinutesBetweenStages } from "@/lib/walkFeasibility";
import type { FestivalSnapshot } from "@/lib/types";

type Slot = FestivalSnapshot["schedule"][number];

export type PlanWalkBand = {
  fromM: number;
  toM: number;
  label: string;
};

/**
 * Horizontal bands spanning all stages: [prev plan end, prev plan end + walk).
 * Walk eats into the next act’s listed start; next plan window should begin at toM.
 */
export function walkBandsBetweenOrderedActs(
  group: FestivalSnapshot,
  orderedSlots: Slot[],
  windows: Record<string, { planFrom: string; planTo: string }>
): PlanWalkBand[] {
  const out: PlanWalkBand[] = [];
  if (!group.walkTimesEnabled || orderedSlots.length < 2) return out;
  for (let i = 0; i < orderedSlots.length - 1; i++) {
    const a = orderedSlots[i]!;
    const b = orderedSlots[i + 1]!;
    const wA = windows[a.id] ?? { planFrom: a.start, planTo: a.end };
    const endA = parseHm(wA.planTo);
    if (Number.isNaN(endA)) continue;
    const walk = walkMinutesBetweenStages(group, a.stageName, b.stageName);
    if (walk <= 0) continue;
    const toM = endA + walk;
    out.push({
      fromM: endA,
      toM,
      label: `${walk}m`,
    });
  }
  return out;
}
