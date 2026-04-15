import type { FestivalSnapshot } from "@/lib/types";

/**
 * Lineup “hot” artists (must/want) → schedule shortlist pins only.
 * Preserves each slot’s plan (wants + planFrom/planTo); does not derive attendance from emojis.
 */
export function buildSlotIntentsFromHotRatings(
  group: FestivalSnapshot,
  memberId: string
): {
  slotId: string;
  wants: boolean;
  personalPlanOnly: boolean;
  scheduleKeep: boolean;
  planFrom: string | null;
  planTo: string | null;
}[] {
  const hotSlotIds = new Set(
    group.schedule
      .filter((slot) => {
        const tier = group.ratings.find(
          (r) => r.memberId === memberId && r.artistId === slot.artistId
        )?.tier;
        return tier === "must" || tier === "want";
      })
      .map((s) => s.id)
  );
  return group.schedule.map((s) => {
    const row = group.allMemberSlotIntents.find(
      (i) => i.memberId === memberId && i.slotId === s.id
    );
    return {
      slotId: s.id,
      wants: row?.wants ?? false,
      personalPlanOnly: row?.personalPlanOnly ?? false,
      scheduleKeep: hotSlotIds.has(s.id),
      planFrom: row?.planFrom ?? null,
      planTo: row?.planTo ?? null,
    };
  });
}
