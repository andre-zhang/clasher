/**
 * Reorder setlist rows so the first N entries aren’t dominated by a few
 * high–setlist-count headliners (global sort). Used when building Spotify playlists.
 */
export function interleaveSetlistRowsByArtist<
  T extends { artistName: string; title: string; count: number },
>(rows: T[], maxOut: number): T[] {
  if (rows.length === 0 || maxOut <= 0) return [];
  const byKey = new Map<string, T[]>();
  for (const r of rows) {
    const k = r.artistName.trim().toLowerCase();
    let b = byKey.get(k);
    if (!b) {
      b = [];
      byKey.set(k, b);
    }
    b.push(r);
  }
  for (const b of byKey.values()) {
    b.sort(
      (a, c) =>
        c.count - a.count ||
        a.title.localeCompare(c.title, undefined, { sensitivity: "base" })
    );
  }
  const artistKeys = [...byKey.keys()].sort((a, c) => a.localeCompare(c));
  const out: T[] = [];
  let round = 0;
  while (out.length < maxOut) {
    let added = 0;
    for (const k of artistKeys) {
      const b = byKey.get(k)!;
      if (round < b.length) {
        out.push(b[round]!);
        added++;
        if (out.length >= maxOut) break;
      }
    }
    if (added === 0) break;
    round++;
  }
  return out;
}
