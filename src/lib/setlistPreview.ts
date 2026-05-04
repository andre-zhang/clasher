import {
  extractSongTitlesFromSetlistDetail,
  getSetlistById,
  isSetlistFmConfigured,
  listSetlistPage,
  searchArtistsByName,
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

/** Baseline spacing; can scale down when many artists are selected so the route finishes before serverless timeouts. */
const REQ_GAP_MS_MAX = 1_000;
const REQ_GAP_MS_MIN = 500;

export async function buildSetlistPreviewForArtists(
  artists: { id: string; name: string }[],
  opts: { maxSetlistsPerArtist: number }
): Promise<SetlistPreviewResult> {
  const { maxSetlistsPerArtist } = opts;
  const maxListPages = Math.min(
    14,
    Math.max(3, Math.ceil(maxSetlistsPerArtist / 18) + 2)
  );
  const approxSleepsPerArtist = 1 + maxListPages + maxSetlistsPerArtist;
  const approxTotalSleeps = Math.max(1, artists.length * approxSleepsPerArtist);
  /** Target ~4m total idle so `/api` can stay under typical `maxDuration` caps with network overhead. */
  const reqGapMs = Math.min(
    REQ_GAP_MS_MAX,
    Math.max(REQ_GAP_MS_MIN, Math.floor(240_000 / approxTotalSleeps))
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
      const nameTrim = a.name.trim();
      const searchQueries = [nameTrim];
      const collabHead = nameTrim.match(/^(.+?)\s+(?:x|×|\/|\+)\s+/i)?.[1]?.trim();
      if (collabHead && collabHead.length >= 2 && !searchQueries.includes(collabHead)) {
        searchQueries.push(collabHead);
      }

      let chosen: Awaited<ReturnType<typeof searchArtistsByName>>[number] | null = null;
      let firstPageSetlists: Awaited<ReturnType<typeof listSetlistPage>>["setlists"] | null =
        null;
      let hadSearchHit = false;

      outer: for (const q of searchQueries) {
        const candidates = await searchArtistsByName(q);
        await sleepMs(reqGapMs);
        if (candidates.length) hadSearchHit = true;
        else continue;
        for (const cand of candidates) {
          const { setlists } = await listSetlistPage(cand.mbid, 1);
          await sleepMs(reqGapMs);
          if (setlists.length > 0) {
            chosen = cand;
            firstPageSetlists = setlists;
            break outer;
          }
        }
      }

      if (!chosen || !firstPageSetlists) {
        entry.error = !hadSearchHit
          ? "No setlist.fm artist match for this name."
          : "No concert setlists on setlist.fm for any close name match (try the spelling setlist.fm uses).";
        outArtists.push(entry);
        continue;
      }
      entry.mbid = chosen.mbid;

      const collectedIds: string[] = [];
      for (const row of firstPageSetlists) {
        if (collectedIds.length >= maxSetlistsPerArtist) break;
        if (!collectedIds.includes(row.id)) collectedIds.push(row.id);
      }
      for (
        let page = 2;
        page <= maxListPages && collectedIds.length < maxSetlistsPerArtist;
        page++
      ) {
        const { setlists } = await listSetlistPage(chosen.mbid, page);
        await sleepMs(reqGapMs);
        for (const row of setlists) {
          if (collectedIds.length >= maxSetlistsPerArtist) break;
          if (!collectedIds.includes(row.id)) collectedIds.push(row.id);
        }
        if (setlists.length < 20) break;
      }

      const perSong = new Map<string, number>();
      for (const sid of collectedIds) {
        const detail = await getSetlistById(sid);
        await sleepMs(reqGapMs);
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

      if (entry.songs.length === 0) {
        if (collectedIds.length === 0) {
          entry.error =
            "No concert setlists on setlist.fm for this match (new/local acts, or the lineup name doesn’t match setlist.fm spelling).";
        } else {
          entry.error =
            "setlist.fm returned setlist pages but no songs could be extracted (empty sets or unexpected API shape).";
        }
      }

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
