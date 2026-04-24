/**
 * Server-side track search (client credentials). No user playlist write — only URIs.
 */
let cachedToken: { token: string; expiresAt: number } | null = null;

function spotifyCredentials(): { id: string; secret: string } | null {
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  return { id, secret };
}

export function isSpotifySearchConfigured(): boolean {
  return spotifyCredentials() !== null;
}

function marketParam(): string {
  return process.env.SPOTIFY_MARKET?.trim() || "US";
}

async function getAccessToken(): Promise<string | null> {
  const c = spotifyCredentials();
  if (!c) return null;
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.token;
  }
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " + Buffer.from(`${c.id}:${c.secret}`).toString("base64"),
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) return null;
  const expiresIn = (j.expires_in ?? 3600) * 1000;
  cachedToken = { token: j.access_token, expiresAt: now + expiresIn };
  return j.access_token;
}

type SearchJson = {
  tracks?: {
    items?: { uri?: string }[];
  };
};

async function searchTracksByQuery(
  q: string,
  limit: number
): Promise<SearchJson | null> {
  const token = await getAccessToken();
  if (!token) return null;
  const u = new URL("https://api.spotify.com/v1/search");
  u.searchParams.set("q", q);
  u.searchParams.set("type", "track");
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("market", marketParam());
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return (await r.json()) as SearchJson;
}

function firstTrackUriFromSearch(j: SearchJson | null): string | null {
  for (const it of j?.tracks?.items ?? []) {
    const u = it?.uri;
    if (typeof u === "string" && u.startsWith("spotify:track:")) {
      return u;
    }
  }
  return null;
}

function stripCommonLiveSuffix(title: string): string {
  return title.replace(/\s*[\(\[](live|acoustic|remix|acoustic version)[\)\]]\s*$/i, "").trim();
}

/**
 * `spotify:track:…` for best search hit. Tries stricter then looser Setlist → Spotify matching.
 */
export async function spotifyTrackUriFor(
  artistName: string,
  trackTitle: string
): Promise<string | null> {
  const artist = artistName.replace(/"/g, "").trim();
  const titleRaw = trackTitle.replace(/"/g, "").trim();
  if (!artist || !titleRaw) return null;
  const title = stripCommonLiveSuffix(titleRaw) || titleRaw;

  const strict = `track:"${titleRaw}" artist:"${artist}"`;
  let u = firstTrackUriFromSearch(await searchTracksByQuery(strict, 1));
  if (u) return u;
  u = firstTrackUriFromSearch(await searchTracksByQuery(
    `track:"${title}" artist:"${artist}"`,
    3
  ));
  if (u) return u;
  u = firstTrackUriFromSearch(
    await searchTracksByQuery(`${artist} ${title}`.trim(), 5)
  );
  if (u) return u;
  return null;
}
