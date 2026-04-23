/**
 * User OAuth: refresh token, create playlist, add tracks (not client-credentials search).
 */
export function spotifyBackendRedirectUri(): string | null {
  const u = process.env.SPOTIFY_REDIRECT_URI?.trim();
  return u && u.length > 0 ? u : null;
}

function clientAuthHeader(): string | null {
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export type SpotifyUserTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export async function spotifyRefreshUserAccess(
  refreshToken: string
): Promise<SpotifyUserTokens | null> {
  const h = clientAuthHeader();
  if (!h) return null;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: h,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as SpotifyUserTokens & { access_token?: string };
  if (!j.access_token) return null;
  return j;
}

export async function spotifyExchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<SpotifyUserTokens & { refresh_token?: string } | null> {
  const h = clientAuthHeader();
  if (!h) return null;
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  if (!id) return null;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: h,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: id,
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.error("[clasher] Spotify token exchange failed:", r.status, t.slice(0, 500));
    return null;
  }
  const j = (await r.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!j.access_token) return null;
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_in: j.expires_in ?? 3600,
  };
}

export async function spotifyCreatePlaylist(
  accessToken: string,
  name: string,
  description: string
): Promise<{ id: string; external_urls?: { spotify?: string } } | null> {
  const r = await fetch("https://api.spotify.com/v1/me/playlists", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: name.slice(0, 100),
      description: description.slice(0, 300),
      public: false,
    }),
  });
  if (!r.ok) return null;
  return (await r.json()) as { id: string; external_urls?: { spotify?: string } };
}

const ADD_CHUNK = 100;

export async function spotifyAddTracks(
  playlistId: string,
  accessToken: string,
  trackUris: string[]
): Promise<boolean> {
  for (let i = 0; i < trackUris.length; i += ADD_CHUNK) {
    const chunk = trackUris.slice(i, i + ADD_CHUNK);
    const r = await fetch(
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: chunk }),
      }
    );
    if (!r.ok) return false;
  }
  return true;
}
