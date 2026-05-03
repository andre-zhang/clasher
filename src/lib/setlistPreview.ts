import {
  extractSongTitlesFromSetlistDetail,
  getSetlistById,
  isSetlistFmConfigured,
  listSetlistPage,
  searchArtistByName,
  sleepMs,
} from "@/lib/setlistfm";
import type {
  SetlistPreviewArtist,
  SetlistPreviewResult,
  SetlistPreviewRow,
} from "@/lib/setlistPreviewTypes";
import { isSpotifySearchConfigured } from "@/lib/spotifySearch";

export type {
  SetlistPreviewArtist,
  SetlistPreviewResult,
  SetlistPreviewRow,
} from "@/lib/setlistPreviewTypes";

function normKey(artist: string, title: string): string {
  return `${artist.trim().toLowerCase()}\t${title.trim().toLowerCase()}`;
}

function youtubeSearch(artist: string, title: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${artist} ${title}`
  )}`;
}

/** Space requests so we stay under setlist.fm’s rate cap (retries still handle 429). */
const REQ_GAP_MS = 1_000;

export async function buildSetlistPreviewForArtists(
  artists: { id: string; name: string }[],
  opts: { maxSetlistsPerArtist: number }
): Promise<SetlistPreviewResult> {
  const { maxSetlistsPerArtist } = opts;
  const maxListPages = Math.min(
    14,
    Math.max(3, Math.ceil(maxSetlistsPerArtist / 18) + 2)
  );
  const sfm = isSetlistFmConfigured();
  const spotifyClient = isSpotifySearchConfigured();

  if (!sfm) {
    return {
      setlistfmConfigured: false,
      spotifyClientConfigured: spotifyClient,
      artists: artists.map((a) => ({
        artistId: a.id,
        name: a.name,
        mbid: null,
        setlistsFetched: 0,
        songs: [],
        error: "setlist.fm API key not configured on server (SETLISTFM_API_KEY).",
      })),
      combined: [],
    };
  }

  const outArtists: SetlistPreviewArtist[] = [];
  const countMap = new Map<string, { artistName: string; title: string; n: number }>();

  for (const a of artists) {
    const entry: SetlistPreviewArtist = {
      artistId: a.id,
      name: a.name,
      mbid: null,
      setlistsFetched: 0,
      songs: [],
    };
    try {
      const hit = await searchArtistByName(a.name);
      await sleepMs(REQ_GAP_MS);
      if (!hit) {
        entry.error = "No setlist.fm artist match for this name.";
        outArtists.push(entry);
        continue;
      }
      entry.mbid = hit.mbid;

      const collectedIds: string[] = [];
      for (
        let page = 1;
        page <= maxListPages && collectedIds.length < maxSetlistsPerArtist;
        page++
      ) {
        const { setlists } = await listSetlistPage(hit.mbid, page);
        await sleepMs(REQ_GAP_MS);
        for (const row of setlists) {
          if (collectedIds.length >= maxSetlistsPerArtist) break;
          if (!collectedIds.includes(row.id)) collectedIds.push(row.id);
        }
        if (setlists.length < 20) break;
      }

      const perSong = new Map<string, number>();
      for (const sid of collectedIds) {
        const detail = await getSetlistById(sid);
        await sleepMs(REQ_GAP_MS);
        entry.setlistsFetched += 1;
        if (!detail) continue;
        const titles = extractSongTitlesFromSetlistDetail(detail);
        const seenInThisList = new Set<string>();
        for (const t of titles) {
          const k = t.trim().toLowerCase();
          if (!k || seenInThisList.has(k)) continue;
          seenInThisList.add(k);
          perSong.set(t, (perSong.get(t) ?? 0) + 1);
        }
      }

      entry.songs = [...perSong.entries()]
        .map(([title, count]) => ({ title, count }))
        .sort((x, y) => y.count - x.count || x.title.localeCompare(y.title));

      for (const s of entry.songs) {
        const key = normKey(a.name, s.title);
        const cur = countMap.get(key);
        if (cur) cur.n += s.count;
        else
          countMap.set(key, {
            artistName: a.name,
            title: s.title,
            n: s.count,
          });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("429") || /too many requests/i.test(msg)) {
        entry.error =
          "setlist.fm rate limit (wait a minute and try again, or contact setlist.fm for a higher API quota).";
      } else {
        entry.error = msg;
      }
    }
    outArtists.push(entry);
  }

  const combined: SetlistPreviewRow[] = [];
  for (const [, v] of countMap) {
    combined.push({
      key: normKey(v.artistName, v.title),
      artistName: v.artistName,
      title: v.title,
      count: v.n,
      youtubeSearchUrl: youtubeSearch(v.artistName, v.title),
    });
  }
  combined.sort(
    (a, b) =>
      b.count - a.count || a.artistName.localeCompare(b.artistName) || a.title.localeCompare(b.title)
  );

  return {
    setlistfmConfigured: true,
    spotifyClientConfigured: spotifyClient,
    artists: outArtists,
    combined,
  };
}
