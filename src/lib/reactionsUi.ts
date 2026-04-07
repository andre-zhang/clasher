import { TIER_EMOJI, TIERS_ORDER, tierFromString } from "@/lib/tiers";
import type { FestivalSnapshot, RatingTier } from "@/lib/types";

function tierCountsForArtist(
  group: FestivalSnapshot,
  artistId: string,
  excludeMemberId?: string
): Record<RatingTier, number> {
  const counts: Record<RatingTier, number> = {
    must: 0,
    want: 0,
    maybe: 0,
    skip: 0,
  };
  for (const r of group.ratings) {
    if (r.artistId !== artistId) continue;
    if (excludeMemberId && r.memberId === excludeMemberId) continue;
    const t = tierFromString(r.tier);
    if (t) counts[t]++;
  }
  return counts;
}

export function compactSquadTierStrip(
  group: FestivalSnapshot,
  artistId: string,
  excludeMemberId?: string
): string {
  const counts = tierCountsForArtist(group, artistId, excludeMemberId);
  const parts = TIERS_ORDER.filter((t) => counts[t] > 0).map(
    (t) => `${TIER_EMOJI[t]}${counts[t]}`
  );
  return parts.length ? parts.join("") : "—";
}

/** Per-tier counts for pill UI (schedule cards). */
export function squadReactionPills(
  group: FestivalSnapshot,
  artistId: string,
  excludeMemberId?: string
): { tier: RatingTier; emoji: string; count: number }[] {
  const counts = tierCountsForArtist(group, artistId, excludeMemberId);
  return TIERS_ORDER.filter((t) => counts[t] > 0).map((t) => ({
    tier: t,
    emoji: TIER_EMOJI[t],
    count: counts[t],
  }));
}

export function myTierEmoji(
  group: FestivalSnapshot,
  artistId: string,
  myMemberId: string
): string {
  const r = group.ratings.find(
    (x) => x.memberId === myMemberId && x.artistId === artistId
  );
  const t = r ? tierFromString(r.tier) : null;
  return t ? TIER_EMOJI[t] : "·";
}
