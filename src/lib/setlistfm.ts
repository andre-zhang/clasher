const BASE = "https://api.setlist.fm/rest/1.0";

function apiKey(): string | null {
  const k = process.env.SETLISTFM_API_KEY?.trim();
  return k || null;
}

function headers(): HeadersInit {
  return {
    Accept: "application/json",
    "x-api-key": apiKey()!,
    "User-Agent": "Clasher/1.0 (https://github.com/andre-zhang/clasher)",
  };
}

export function isSetlistFmConfigured(): boolean {
  return Boolean(apiKey());
}

type Json = Record<string, unknown>;

export type SetlistfmArtistHit = { name: string; mbid: string; sortName?: string };

/**
 * @returns first matching artist for name search, or null
 */
export async function searchArtistByName(
  name: string
): Promise<SetlistfmArtistHit | null> {
  if (!apiKey()) return null;
  const q = new URLSearchParams({ artistName: name.trim(), p: "1" });
  const r = await fetch(`${BASE}/search/artists?${q}`, { headers: headers() });
  if (!r.ok) {
    if (r.status === 404) return null;
    const t = await r.text().catch(() => "");
    throw new Error(
      `setlist.fm search artists: HTTP ${r.status} ${t.slice(0, 200)}`
    );
  }
  const j = (await r.json()) as Json;
  const arr = j.artist;
  if (!Array.isArray(arr) || !arr.length) return null;
  const a = arr[0] as Json;
  const mbid = String(a.mbid ?? "");
  if (!mbid) return null;
  return {
    name: String(a.name ?? name),
    mbid,
    sortName: a.sortName ? String(a.sortName) : undefined,
  };
}

export type SetlistIdRow = { id: string; eventDate?: string };

/** Page of setlist IDs for an artist (no full songs in list). */
export async function listSetlistPage(
  artistMbid: string,
  page: number
): Promise<{ setlists: SetlistIdRow[]; total: number }> {
  if (!apiKey()) {
    return { setlists: [], total: 0 };
  }
  const r = await fetch(
    `${BASE}/artist/${encodeURIComponent(artistMbid)}/setlists?p=${page}`,
    { headers: headers() }
  );
  if (!r.ok) {
    if (r.status === 404) return { setlists: [], total: 0 };
    const t = await r.text().catch(() => "");
    throw new Error(
      `setlist.fm list setlists: HTTP ${r.status} ${t.slice(0, 200)}`
    );
  }
  const j = (await r.json()) as Json;
  const raw = j.setlist;
  const out: SetlistIdRow[] = [];
  if (Array.isArray(raw)) {
    for (const row of raw) {
      const o = row as Json;
      const id = String(o.id ?? "");
      if (id) out.push({ id, eventDate: o.eventDate ? String(o.eventDate) : undefined });
    }
  }
  const total = typeof j.total === "number" ? j.total : out.length;
  return { setlists: out, total };
}

function setsArray(sets: unknown): Json[] {
  if (!sets) return [];
  if (Array.isArray(sets)) return sets as Json[];
  if (typeof sets === "object" && sets !== null) {
    const s = (sets as Json).set;
    if (Array.isArray(s)) return s as Json[];
    if (s) return [s as Json];
  }
  return [];
}

function songsArray(song: unknown): Json[] {
  if (!song) return [];
  if (Array.isArray(song)) return song as Json[];
  return [song as Json];
}

export function extractSongTitlesFromSetlistDetail(json: Json): string[] {
  const out: string[] = [];
  for (const block of setsArray(json.sets)) {
    for (const s of songsArray((block as Json).song)) {
      const song = s as Json;
      if (song.tape === true) continue;
      const name = String(song.name ?? "").trim();
      if (!name) {
        const cover = song.cover as Json | undefined;
        if (cover && typeof cover.name === "string") {
          out.push(cover.name.trim());
        }
        continue;
      }
      const lo = name.toLowerCase();
      if (lo === "tape" || lo === "intro" || lo === "outro" || lo === "intermission") {
        continue;
      }
      out.push(name);
    }
  }
  return out;
}

/** Full setlist with `sets` array. */
export async function getSetlistById(setlistId: string): Promise<Json | null> {
  if (!apiKey()) return null;
  const r = await fetch(
    `${BASE}/setlist/${encodeURIComponent(setlistId)}`,
    { headers: headers() }
  );
  if (!r.ok) {
    if (r.status === 404) return null;
    const t = await r.text().catch(() => "");
    throw new Error(
      `setlist.fm get setlist: HTTP ${r.status} ${t.slice(0, 200)}`
    );
  }
  return (await r.json()) as Json;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
