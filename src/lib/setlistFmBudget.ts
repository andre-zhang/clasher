/**
 * setlist.fm: each selected artist needs a search + listing paginations + one GET
 * per concert setlist (each response already contains many song titles). We cap
 * total “depth” so large selections stay polite to the API, while small selections
 * get richer history (same rough total budget of setlist detail fetches).
 *
 * Note: total wall time still grows with artist count (~1s between requests in
 * setlistPreview). Very large previews may hit hosting request timeouts.
 */
export const SETLIST_FM_MAX_DETAIL_PER_ARTIST = 28;

/** Target total `getSetlistById` calls across the whole lineup (spread per artist). */
const DETAIL_BUDGET_TOTAL = 280;

/**
 * How many concert setlists to fully fetch per artist before aggregating.
 * @param requested optional client override (still clamped).
 */
export function maxSetlistsPerArtistForLineupSize(
  nArtists: number,
  requested?: number | null
): number {
  const n = Math.max(1, Math.floor(nArtists));
  if (requested != null && Number.isFinite(requested)) {
    return Math.min(
      SETLIST_FM_MAX_DETAIL_PER_ARTIST,
      Math.max(1, Math.floor(requested))
    );
  }
  const spread = Math.floor(DETAIL_BUDGET_TOTAL / n);
  return Math.min(SETLIST_FM_MAX_DETAIL_PER_ARTIST, Math.max(2, spread));
}
