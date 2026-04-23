/**
 * Server-side track search (client credentials). No user playlist write — only URLs.
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

/** First track result open.spotify.com link, or null. */
export async function spotifyTrackUrlFor(
  artistName: string,
  trackTitle: string
): Promise<string | null> {
  const token = await getAccessToken();
  if (!token) return null;
  const q = `track:"${trackTitle.replace(/"/g, "")}" artist:"${artistName.replace(/"/g, "")}"`;
  const u = new URL("https://api.spotify.com/v1/search");
  u.searchParams.set("q", q);
  u.searchParams.set("type", "track");
  u.searchParams.set("limit", "1");
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const j = (await r.json()) as {
    tracks?: { items?: { external_urls?: { spotify?: string } }[] };
  };
  const first = j.tracks?.items?.[0];
  const url = first?.external_urls?.spotify;
  return url ?? null;
}
