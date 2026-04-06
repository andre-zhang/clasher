import type { RatingTier } from "@/lib/types";

export const TIER_EMOJI: Record<RatingTier, string> = {
  must: "❤️",
  want: "🔥",
  maybe: "🤔",
  skip: "👎",
};

export const TIERS_ORDER: RatingTier[] = ["must", "want", "maybe", "skip"];

export function tierFromString(t: string): RatingTier | null {
  if (t === "must" || t === "want" || t === "maybe" || t === "skip") return t;
  return null;
}
