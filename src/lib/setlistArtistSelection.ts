import type { FestivalSnapshot } from "@/lib/types";

/**
 * Default setlist pool: same rules as the server’s implicit selection —
 * your must / want / maybe ratings plus artists on slots you marked on your plan.
 */
export function suggestedSetlistArtistIds(
  group: FestivalSnapshot,
  memberId: string
): string[] {
  const s = new Set<string>();
  for (const r of group.ratings ?? []) {
    if (r.memberId !== memberId) continue;
    if (r.tier === "must" || r.tier === "want" || r.tier === "maybe") {
      s.add(r.artistId);
    }
  }
  for (const slot of group.schedule) {
    const i = group.memberSlotIntents.find((x) => x.slotId === slot.id);
    if (i?.wants) s.add(slot.artistId);
  }
  return [...s];
}

const SETLIST_MAX = 30;

export function isValidSetlistSelectionCount(n: number): boolean {
  return n >= 1 && n <= SETLIST_MAX;
}

export const SETLIST_ARTIST_CAP = SETLIST_MAX;

export function setlistStorageKey(squadId: string, memberId: string): string {
  return `clasher_setlist_artistIds_${squadId}_${memberId}`;
}
