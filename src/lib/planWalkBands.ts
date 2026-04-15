import { parseHm, wallMinutesToFestivalTimeline } from "@/lib/timeHm";
import { walkMinutesBetweenStages } from "@/lib/walkFeasibility";
import type { FestivalSnapshot } from "@/lib/types";

type Slot = FestivalSnapshot["schedule"][number];

export type PlanWalkBand = {
  fromM: number;
  toM: number;
  label: string;
};

type StagePlanRow = {
  id: string;
  stageName: string;
  defaultFrom: string;
  defaultTo: string;
};

function walkBandsBetweenOrderedStageRows(
  group: FestivalSnapshot,
  rows: StagePlanRow[],
  windows: Record<string, { planFrom: string; planTo: string } | undefined>
): PlanWalkBand[] {
  const out: PlanWalkBand[] = [];
  if (!group.walkTimesEnabled || rows.length < 2) return out;
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i]!;
    const b = rows[i + 1]!;
    const wA =
      windows[a.id] ?? { planFrom: a.defaultFrom, planTo: a.defaultTo };
    const endA = wallMinutesToFestivalTimeline(parseHm(wA.planTo));
    if (Number.isNaN(endA)) continue;
    const wB =
      windows[b.id] ?? { planFrom: b.defaultFrom, planTo: b.defaultTo };
    const startB = wallMinutesToFestivalTimeline(parseHm(wB.planFrom));
    if (Number.isNaN(startB)) continue;
    const walk = walkMinutesBetweenStages(
      group,
      a.stageName,
      b.stageName
    );
    if (walk <= 0) continue;
    /** If the next act already starts later than required walk, skip the band. */
    const gap = startB - endA;
    if (gap > walk) continue;
    const toM = Math.min(endA + walk, startB);
    if (toM <= endA) continue;
    out.push({
      fromM: endA,
      toM,
      label: `${walk}m`,
    });
  }
  return out;
}

/**
 * Horizontal bands spanning all stages: [prev plan end, prev plan end + walk).
 * Walk eats into the next act’s listed start; next plan window should begin at toM.
 */
export function walkBandsBetweenOrderedActs(
  group: FestivalSnapshot,
  orderedSlots: Slot[],
  windows: Record<string, { planFrom: string; planTo: string }>
): PlanWalkBand[] {
  const rows: StagePlanRow[] = orderedSlots.map((s) => ({
    id: s.id,
    stageName: s.stageName,
    defaultFrom: s.start,
    defaultTo: s.end,
  }));
  return walkBandsBetweenOrderedStageRows(group, rows, windows);
}

