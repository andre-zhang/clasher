import type { FestivalSnapshot } from "@/lib/types";

/** Build slot intent rows: true only for slots whose artist is ❤️/🔥 for this member. */
export function buildSlotIntentsFromHotRatings(
  group: FestivalSnapshot,
  memberId: string
): { slotId: string; wants: boolean }[] {
  const wantsIds = new Set(
    group.schedule
      .filter((slot) => {
        const tier = group.ratings.find(
          (r) => r.memberId === memberId && r.artistId === slot.artistId
        )?.tier;
        return tier === "must" || tier === "want";
      })
      .map((s) => s.id)
  );
  const hot = (id: string) => wantsIds.has(id);
  return group.schedule.map((s) => ({
    slotId: s.id,
    wants: hot(s.id),
    scheduleKeep: hot(s.id),
  }));
}
