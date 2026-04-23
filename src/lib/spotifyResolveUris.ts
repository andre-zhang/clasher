import { sleepMs } from "@/lib/setlistfm";
import { spotifyTrackUriFor } from "@/lib/spotifySearch";

const GAP_MS = 80;

/** @param maxUris cap how many we resolve (Spotify + request time) */
export async function spotifyUrisForSetlistRows(
  rows: { artistName: string; title: string }[],
  maxUris: number
): Promise<{ uris: string[]; notFound: number }> {
  const uris: string[] = [];
  const seen = new Set<string>();
  let notFound = 0;
  for (const row of rows) {
    if (uris.length >= maxUris) break;
    const u = await spotifyTrackUriFor(row.artistName, row.title);
    await sleepMs(GAP_MS);
    if (u) {
      if (seen.has(u)) continue;
      seen.add(u);
      uris.push(u);
    } else {
      notFound += 1;
    }
  }
  return { uris, notFound };
}
