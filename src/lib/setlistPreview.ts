import {
  extractSongTitlesFromSetlistDetail,
  getSetlistById,
  isSetlistFmConfigured,
  listSetlistPage,
  sleepMs,
} from "@/lib/setlistfm";
import { resolveArtistWithSetlists } from "@/lib/setlistFmFuzzy";
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
const REQ_GAP_MS_MIN_LARGE_LINEUP = 280;

export async function buildSetlistPreviewForArtists(
  artists: { id: string; name: string }[],
  opts: { maxSetlistsPerArtist: number; /** Whole Build selection size when this request is a chunk. */ fuzzyLineupSize?: number }
): Promise<SetlistPreviewResult> {
  const { maxSetlistsPerArtist } = opts;
  const fuzzyLineupSize = Math.max(artists.length, opts.fuzzyLineupSize ?? artists.length);
  const maxListPages = Math.min(
    14,
    Math.max(3, Math.ceil(maxSetlistsPerArtist / 18) + 2)
  );
  const approxSleepsPerArtist = 1 + maxListPages + maxSetlistsPerArtist;
  const approxTotalSleeps = Math.max(1, artists.length * approxSleepsPerArtist);
  const gapFloor =
    fuzzyLineupSize > 12 ? REQ_GAP_MS_MIN_LARGE_LINEUP : REQ_GAP_MS_MIN;
  /** Target ~3m total idle; large lineups allow slightly tighter gaps to finish under Vercel maxDuration. */
  const reqGapMs = Math.min(
    REQ_GAP_MS_MAX,
    Math.max(gapFloor, Math.floor(180_000 / approxTotalSleeps))
  );
  /** Fuzzy only after fast path misses — keep probes small so chunked Lambdas stay << 300s. */
  const fuzzyOpts =
    fuzzyLineupSize > 24
      ? { maxSearchVariants: 4, maxMbidProbePages: 5, hitsPerSearch: 8 }
      : fuzzyLineupSize > 16
        ? { maxSearchVariants: 4, maxMbidProbePages: 5, hitsPerSearch: 8 }
        : fuzzyLineupSize > 8
          ? { maxSearchVariants: 4, maxMbidProbePages: 5, hitsPerSearch: 8 }
          : {};
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
      const resolved = await resolveArtistWithSetlists(a.name, reqGapMs, fuzzyOpts);
      if (!resolved.ok) {
        entry.error = resolved.reason === "no_search_hits" ? "No setlist.fm match." : "No setlists found.";
        outArtists.push(entry);
        continue;
      }
      const firstPageSetlists = resolved.firstPageSetlists;
      entry.mbid = resolved.mbid;

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
        if (!resolved.mbid) break;
        const { setlists } = await listSetlistPage(resolved.mbid, page);
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
          entry.error = "No setlists found.";
        } else {
          entry.error = "No songs found in fetched setlists.";
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
