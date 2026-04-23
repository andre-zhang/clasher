const BASE = "https://api.setlist.fm/rest/1.0";

/** setlist.fm enforces strict limits; ~1 req/s is a safe default (forum reports 429 even at 1/s). */
const RATE_429_MAX_RETRIES = 8;
const RATE_429_BASE_MS = 1_200;

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

function parseRetryAfterMs(r: Response): number | null {
  const h = r.headers.get("Retry-After");
  if (!h) return null;
  const sec = parseInt(h.trim(), 10);
  if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  const t = Date.parse(h);
  if (!Number.isNaN(t)) {
    const ms = t - Date.now();
    if (ms > 0) return ms;
  }
  return null;
}

/** GET to setlist.fm with retries on HTTP 429 (exponential backoff + optional Retry-After). */
async function fetchSetlistFm(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const r = await fetch(url, { headers: headers() });
    if (r.status !== 429) return r;
    if (attempt >= RATE_429_MAX_RETRIES) return r;
    const fromHeader = parseRetryAfterMs(r);
    const backoff = RATE_429_BASE_MS * Math.pow(2, attempt);
    const cap = 60_000;
    const wait = Math.min(
      cap,
      fromHeader != null && fromHeader > 0 ? Math.max(fromHeader, backoff) : backoff
    );
    await sleepMs(wait);
  }
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
  const r = await fetchSetlistFm(`${BASE}/search/artists?${q}`);
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
  const r = await fetchSetlistFm(
    `${BASE}/artist/${encodeURIComponent(artistMbid)}/setlists?p=${page}`
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
  const r = await fetchSetlistFm(
    `${BASE}/setlist/${encodeURIComponent(setlistId)}`
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

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { sleepMs };
