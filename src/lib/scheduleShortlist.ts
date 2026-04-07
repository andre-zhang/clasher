import type { FestivalSnapshot } from "@/lib/types";

/** Lineup ❤️ / 🔥 for this artist. */
export function memberRatesHotForArtist(
  group: FestivalSnapshot,
  memberId: string,
  artistId: string
): boolean {
  const t = group.ratings.find(
    (r) => r.memberId === memberId && r.artistId === artistId
  )?.tier;
  return t === "must" || t === "want";
}

/**
 * Schedule tab “Your plan”: show slot if lineup hot for artist OR user pinned in full timetable.
 * Does not use clash / squad-default resolution.
 */
export function memberKeepsSlotOnScheduleShortlist(
  group: FestivalSnapshot,
  memberId: string,
  slotId: string
): boolean {
  const slot = group.schedule.find((s) => s.id === slotId);
  if (!slot) return false;
  if (memberRatesHotForArtist(group, memberId, slot.artistId)) return true;
  const row = group.allMemberSlotIntents.find(
    (i) => i.memberId === memberId && i.slotId === slotId
  );
  return row?.scheduleKeep ?? false;
}
