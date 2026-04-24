"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useClasher } from "@/context/ClasherContext";
import {
  apiSetlistPreview,
  apiSetlistSpotifyPlaylist,
  apiSpotifyAuthorizeUrl,
  apiSpotifyStatus,
} from "@/lib/api";
import type { FestivalSnapshot } from "@/lib/types";
import type { SetlistPreviewResult } from "@/lib/setlistPreviewTypes";

function hasEligibleArtists(group: FestivalSnapshot, memberId: string): boolean {
  for (const r of group.ratings ?? []) {
    if (r.memberId !== memberId) continue;
    if (r.tier === "must" || r.tier === "want" || r.tier === "maybe") {
      return true;
    }
  }
  for (const s of group.schedule) {
    const i = group.memberSlotIntents.find((x) => x.slotId === s.id);
    if (i?.wants) return true;
  }
  return false;
}

export function LineupSetlistPanel() {
  const pathname = usePathname();
  const { session, group } = useClasher();
  const [busy, setBusy] = useState(false);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<SetlistPreviewResult | null>(null);
  const [spotify, setSpotify] = useState<{
    clientConfigured: boolean;
    redirectUriConfigured: boolean;
    canSignIn: boolean;
    spotifyConnected: boolean;
  } | null>(null);
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(null);

  const canRun = useMemo(() => {
    if (!group || !session) return false;
    return hasEligibleArtists(group, session.memberId);
  }, [group, session]);

  const loadSpotify = useCallback(async () => {
    if (!session) return;
    try {
      const s = await apiSpotifyStatus(session);
      setSpotify(s);
    } catch {
      setSpotify(null);
    }
  }, [session]);

  useEffect(() => {
    void loadSpotify();
  }, [loadSpotify]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const s = sp.get("spotify");
    const reason = sp.get("reason");
    if (s === "connected" || s === "denied" || s === "error") {
      void loadSpotify().then(() => {
        if (s === "denied") {
          const se = (sp.get("se") ?? "").toLowerCase();
          const sd = (sp.get("sd") ?? "").trim();
          if (se === "access_denied") {
            setErr("Spotify login was cancelled. Tap Connect again when you want to continue.");
          } else if (se === "invalid_scope") {
            setErr(
              "invalid_scope: deploy the latest Clasher (Spotify does not use the OIDC `offline_access` scope). If this still appears, paste your Spotify `error_description` for support."
            );
          } else if (se === "redirect_uri_mismatch") {
            setErr(
              "redirect_uri_mismatch: the callback URL does not match. In the Spotify app settings, add exactly the same URL as SPOTIFY_REDIRECT_URI (including https and path /api/spotify/callback), save, redeploy, and try again."
            );
          } else if (se === "invalid_client" || se === "invalid_client_id") {
            setErr("invalid_client: check SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET on the server match the Spotify app.");
          } else if (se) {
            setErr(
              `Spotify returned: ${se}${sd ? ` — ${sd}` : ""}`.trim()
            );
          } else {
            setErr("Spotify sign-in did not complete. Try Connect again.");
          }
        } else if (s === "error") {
          if (reason === "token_exchange") {
            setErr(
              "Spotify could not complete login (token exchange). Check that SPOTIFY_REDIRECT_URI in the server exactly matches a Redirect URI in the Spotify app, and redeploy if you just changed env."
            );
          } else if (reason === "no_refresh") {
            setErr("Spotify did not return a refresh token — re-authorize with Connect Spotify.");
          } else if (reason === "db" || reason === "member") {
            setErr("Spotify worked but saving your session failed. Try again or run database migrations (spotify refresh token on Member).");
          } else if (reason === "no_redirect_uri") {
            setErr("Server is missing SPOTIFY_REDIRECT_URI in environment.");
          } else {
            setErr("Spotify sign-in failed. Check server logs and your Spotify + env settings.");
          }
        }
        sp.delete("spotify");
        sp.delete("reason");
        sp.delete("se");
        sp.delete("sd");
        const nextQ = sp.toString();
        const next =
          nextQ.length > 0
            ? `${window.location.pathname}?${nextQ}`
            : window.location.pathname;
        window.history.replaceState(null, "", next);
      });
    }
  }, [loadSpotify]);

  const run = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setErr(null);
    setPlaylistUrl(null);
    try {
      const p = await apiSetlistPreview(session, {});
      setPreview(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, [session]);

  const connectSpotify = useCallback(async () => {
    if (!session) return;
    setErr(null);
    try {
      const returnTo =
        pathname && pathname.length > 0
          ? pathname
          : `/squad/${session.squadId}/lineup`;
      const u = await apiSpotifyAuthorizeUrl(session, returnTo);
      window.location.assign(u);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [session, pathname]);

  const createPlaylist = useCallback(async () => {
    if (!session) return;
    setPlaylistBusy(true);
    setErr(null);
    setPlaylistUrl(null);
    try {
      const o = await apiSetlistSpotifyPlaylist(session, {});
      setPlaylistUrl(o.playlistUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPlaylistBusy(false);
    }
  }, [session]);

  const copyPlain = () => {
    if (!preview?.combined.length) return;
    const t = preview.combined
      .map((r) => `${r.artistName} — ${r.title}`)
      .join("\n");
    void navigator.clipboard.writeText(t);
  };

  const copyTsv = () => {
    if (!preview?.combined.length) return;
    const t = [
      "artist\ttitle\tweight",
      ...preview.combined.map(
        (r) => `${r.artistName}\t${r.title}\t${r.count}`
      ),
    ].join("\n");
    void navigator.clipboard.writeText(t);
  };

  if (!group || !session) return null;

  const canPlaylist =
    Boolean(preview?.combined.length) &&
    spotify?.clientConfigured &&
    spotify.spotifyConnected;
  const canShowConnect = spotify?.canSignIn && !spotify.spotifyConnected;

  return (
    <details className="border-2 border-zinc-900 bg-zinc-50 shadow-[2px_2px_0_0_#18181b]">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-zinc-900">
        Festival setlist
      </summary>
      <div className="space-y-3 border-t-2 border-zinc-900 px-3 pb-3 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !canRun}
            onClick={() => void run()}
            className="touch-manipulation border-2 border-zinc-900 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            {busy ? "…" : "Build"}
          </button>

          {canShowConnect ? (
            <button
              type="button"
              onClick={() => void connectSpotify()}
              className="touch-manipulation border-2 border-[#1DB954] bg-[#1DB954] px-3 py-1.5 text-xs font-semibold text-black"
            >
              Connect Spotify
            </button>
          ) : null}

          {spotify?.clientConfigured && spotify.spotifyConnected ? (
            <button
              type="button"
              disabled={playlistBusy || !canPlaylist}
              onClick={() => void createPlaylist()}
              className="touch-manipulation border-2 border-zinc-900 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 disabled:opacity-40"
            >
              {playlistBusy ? "…" : "Add playlist in Spotify"}
            </button>
          ) : null}
        </div>

        {err ? (
          <p className="border-2 border-red-800 bg-red-50 px-2 py-1.5 text-xs text-red-900">
            {err}
          </p>
        ) : null}

        {spotify && !spotify.clientConfigured ? (
          <p className="text-xs text-zinc-500">
            Spotify playlist: add{" "}
            <code className="rounded bg-zinc-200 px-1">SPOTIFY_CLIENT_ID</code>{" "}
            and <code className="rounded bg-zinc-200 px-1">SPOTIFY_CLIENT_SECRET</code>{" "}
            on the server, plus a redirect callback URL in env (see .env.example).
          </p>
        ) : null}
        {spotify?.clientConfigured && !spotify.canSignIn && !spotify.redirectUriConfigured ? (
          <p className="text-xs text-amber-950">
            Set <code className="rounded bg-amber-100 px-1">SPOTIFY_REDIRECT_URI</code>{" "}
            (must match the Spotify app&apos;s callback URL exactly).
          </p>
        ) : null}
        {spotify?.clientConfigured &&
        spotify.redirectUriConfigured &&
        !spotify.canSignIn ? (
          <p className="text-xs text-amber-950">
            Set <code className="rounded bg-amber-100 px-1">SPOTIFY_STATE_SECRET</code>{" "}
            (or rely on the client secret) to sign the OAuth state.
          </p>
        ) : null}

        {playlistUrl ? (
          <p className="text-xs text-zinc-900">
            Open your playlist:{" "}
            <a
              href={playlistUrl}
              className="text-indigo-700 underline"
              target="_blank"
              rel="noreferrer"
            >
              Open in Spotify
            </a>
          </p>
        ) : null}

        {preview && !preview.setlistfmConfigured ? (
          <p className="text-xs text-amber-950">
            <code className="rounded bg-amber-100 px-1">SETLISTFM_API_KEY</code>{" "}
            not set on server.
          </p>
        ) : null}

        {preview && preview.combined.length > 0 ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copyPlain}
                className="border-2 border-zinc-900 bg-white px-2 py-1 text-xs font-medium"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={copyTsv}
                className="border-2 border-zinc-900 bg-white px-2 py-1 text-xs font-medium"
              >
                Copy TSV
              </button>
            </div>

            <div className="max-h-80 overflow-auto overflow-x-auto border-2 border-zinc-900 bg-white">
              <table className="w-full min-w-[20rem] border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-zinc-100">
                    <th className="border-b border-zinc-400 px-2 py-1">Artist</th>
                    <th className="border-b border-zinc-400 px-2 py-1">Song</th>
                    <th className="border-b border-zinc-400 px-2 py-1">#</th>
                    <th className="border-b border-zinc-400 px-2 py-1">YouTube</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.combined.map((r) => (
                    <tr key={r.key} className="border-b border-zinc-200">
                      <td className="px-2 py-0.5 align-top [overflow-wrap:anywhere]">
                        {r.artistName}
                      </td>
                      <td className="px-2 py-0.5 align-top [overflow-wrap:anywhere]">
                        {r.title}
                      </td>
                      <td className="px-2 py-0.5 text-zinc-600">{r.count}</td>
                      <td className="px-2 py-0.5">
                        <a
                          href={r.youtubeSearchUrl}
                          className="text-indigo-700 underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Search
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {preview?.artists.some((a) => a.error) ? (
          <ul className="list-inside list-disc text-xs text-zinc-600">
            {preview.artists
              .filter((a) => a.error)
              .map((a) => (
                <li key={a.artistId}>
                  {a.name}: {a.error}
                </li>
              ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
