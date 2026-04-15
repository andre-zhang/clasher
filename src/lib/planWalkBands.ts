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
    const walk = walkMinutesBetweenStages(
      group,
      a.stageName,
      b.stageName
    );
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

/**
 * Walk segments for wallpaper export rows (no schedule ids): same order as {@link PlanCalendarSlot} list.
 */
export function walkBandsForOrderedPlanCalendarSlots(
  group: FestivalSnapshot,
  orderedSlots: { start: string; end: string; stage: string }[]
): PlanWalkBand[] {
  if (!orderedSlots.length) return [];
  const rows: StagePlanRow[] = orderedSlots.map((s, i) => ({
    id: `export-${i}`,
    stageName: s.stage.trim(),
    defaultFrom: s.start,
    defaultTo: s.end,
  }));
  const windows: Record<string, { planFrom: string; planTo: string }> = {};
  for (let i = 0; i < orderedSlots.length; i++) {
    const s = orderedSlots[i]!;
    windows[`export-${i}`] = { planFrom: s.start, planTo: s.end };
  }
  return walkBandsBetweenOrderedStageRows(group, rows, windows);
}
