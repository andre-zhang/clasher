"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useClasher } from "@/context/ClasherContext";
import {
  apiSetlistPreview,
  apiSetlistSpotifyPlaylist,
  apiSpotifyAuthorizeUrl,
  apiSpotifyStatus,
} from "@/lib/api";
import {
  SETLIST_ARTIST_CAP,
  setlistStorageKey,
  suggestedSetlistArtistIds,
} from "@/lib/setlistArtistSelection";
import { myTierEmoji } from "@/lib/reactionsUi";
import type { SetlistPreviewResult } from "@/lib/setlistPreviewTypes";

export function LineupSetlistPanel() {
  const pathname = usePathname();
  const { session, group } = useClasher();
  const setlistInitKeyRef = useRef<string | null>(null);
  const [setlistArtistIds, setSetlistArtistIds] = useState<string[] | null>(null);
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
  const [exportNote, setExportNote] = useState(false);

  /** One row per artist id (lineup can contain duplicate names with different ids). */
  const artistsForPickUi = useMemo(() => {
    if (!group?.artists?.length) return [];
    const byId = new Map<
      string,
      { id: string; name: string; sortOrder: number }
    >();
    for (const a of group.artists) {
      if (!byId.has(a.id)) byId.set(a.id, a);
    }
    return [...byId.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [group?.artists]);

  /** Same name can refer to two billing rows (different ids); disambiguate in the list. */
  const disambigName = useCallback((a: (typeof artistsForPickUi)[number]) => {
    const sameName = artistsForPickUi.filter(
      (x) =>
        x.name.toLowerCase() === a.name.toLowerCase()
    );
    if (sameName.length <= 1) return a.name;
    return `${a.name} · ${a.id.slice(0, 4)}`;
  }, [artistsForPickUi]);

  /** One-time init per squad+member: sessionStorage, else “My picks”. Refetching snapshot won’t wipe. */
  useEffect(() => {
    if (!group || !session) return;
    const k = `${group.id}:${session.memberId}`;
    if (setlistInitKeyRef.current === k) return;
    setlistInitKeyRef.current = k;
    const stKey = setlistStorageKey(group.id, session.memberId);
    const sug = suggestedSetlistArtistIds(group, session.memberId);
    try {
      const raw = sessionStorage.getItem(stKey);
      if (raw) {
        const p = JSON.parse(raw) as unknown;
        if (Array.isArray(p) && p.length) {
          const v = new Set(group.artists.map((a) => a.id));
          const filtered = p.filter(
            (id): id is string => typeof id === "string" && v.has(id)
          );
          if (filtered.length) {
            setSetlistArtistIds(filtered.slice(0, SETLIST_ARTIST_CAP));
            return;
          }
        }
      }
    } catch {
      /* ignore */
    }
    setSetlistArtistIds(sug.slice(0, SETLIST_ARTIST_CAP));
  }, [group, session]);

  useEffect(() => {
    if (!group || !session || setlistArtistIds == null) return;
    try {
      sessionStorage.setItem(
        setlistStorageKey(group.id, session.memberId),
        JSON.stringify(setlistArtistIds)
      );
    } catch {
      /* ignore */
    }
  }, [group, session, setlistArtistIds]);

  const canRun = useMemo(() => {
    if (!group || !session) return false;
    if (!setlistArtistIds?.length) return false;
    if (setlistArtistIds.length > SETLIST_ARTIST_CAP) return false;
    if (!artistsForPickUi.length) return false;
    return true;
  }, [group, session, setlistArtistIds, artistsForPickUi.length]);

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
    if (!session || !setlistArtistIds?.length) return;
    if (setlistArtistIds.length > SETLIST_ARTIST_CAP) {
      setErr(`Select at most ${SETLIST_ARTIST_CAP} artists.`);
      return;
    }
    setBusy(true);
    setErr(null);
    setPlaylistUrl(null);
    try {
      const p = await apiSetlistPreview(session, { artistIds: setlistArtistIds });
      setPreview(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, [session, setlistArtistIds]);

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
    if (!session || !setlistArtistIds?.length) return;
    if (setlistArtistIds.length > SETLIST_ARTIST_CAP) {
      setErr(`Select at most ${SETLIST_ARTIST_CAP} artists.`);
      return;
    }
    setPlaylistBusy(true);
    setErr(null);
    setPlaylistUrl(null);
    try {
      const o = await apiSetlistSpotifyPlaylist(session, {
        artistIds: setlistArtistIds,
      });
      setPlaylistUrl(o.playlistUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPlaylistBusy(false);
    }
  }, [session, setlistArtistIds]);

  const copyPlain = () => {
    if (!preview?.combined.length) return;
    setExportNote(true);
    window.setTimeout(() => setExportNote(false), 2500);
    const t = preview.combined
      .map((r) => `${r.artistName} — ${r.title}`)
      .join("\n");
    void navigator.clipboard.writeText(t);
  };

  const copyTsv = () => {
    if (!preview?.combined.length) return;
    setExportNote(true);
    window.setTimeout(() => setExportNote(false), 2500);
    const t = [
      "artist\ttitle\tweight",
      ...preview.combined.map(
        (r) => `${r.artistName}\t${r.title}\t${r.count}`
      ),
    ].join("\n");
    void navigator.clipboard.writeText(t);
  };

  if (!group || !session) return null;

  const selectedSet = new Set(setlistArtistIds ?? []);
  const toggleArtist = (id: string) => {
    setSetlistArtistIds((prev) => {
      if (prev == null) return prev;
      const s = new Set(prev);
      if (s.has(id)) {
        s.delete(id);
        return [...s];
      }
      if (s.size >= SETLIST_ARTIST_CAP) return prev;
      s.add(id);
      return [...s];
    });
  };
  const pickMyPicks = () => {
    if (!group || !session) return;
    setSetlistArtistIds(
      suggestedSetlistArtistIds(group, session.memberId).slice(0, SETLIST_ARTIST_CAP)
    );
  };
  const pickNone = () => {
    setSetlistArtistIds([]);
  };

  const canPlaylist =
    Boolean(preview?.combined.length) &&
    spotify?.clientConfigured &&
    spotify.spotifyConnected;
  const canShowConnect = spotify?.canSignIn && !spotify.spotifyConnected;
  const showWaitNote = busy || playlistBusy || exportNote;

  return (
    <details className="border-2 border-zinc-900 bg-zinc-50 shadow-[2px_2px_0_0_#18181b]">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-zinc-900">
        Festival setlist
      </summary>
      <div className="space-y-3 border-t-2 border-zinc-900 px-3 pb-3 pt-2">
        {artistsForPickUi.length > 0 && setlistArtistIds != null ? (
          <div className="border-2 border-zinc-900 bg-white p-2 shadow-[2px_2px_0_0_#18181b]">
            <p className="mb-2 text-xs font-semibold text-zinc-900">Artists</p>
            <div className="mb-2 flex flex-wrap gap-1">
              <button
                type="button"
                onClick={pickMyPicks}
                className="border-2 border-zinc-900 bg-white px-2 py-1 text-xs font-medium text-zinc-900"
              >
                My picks
              </button>
              <button
                type="button"
                onClick={pickNone}
                className="border-2 border-zinc-900 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-800"
              >
                None
              </button>
            </div>
            <div className="max-h-40 space-y-0.5 overflow-y-auto border-2 border-zinc-900 bg-zinc-50/80 px-2 py-1.5">
              {artistsForPickUi.map((a) => {
                const on = selectedSet.has(a.id);
                const onPlan = group.schedule.some(
                  (s) => s.artistId === a.id
                    && group.memberSlotIntents.find((i) => i.slotId === s.id)?.wants
                );
                return (
                  <label
                    key={a.id}
                    className="flex cursor-pointer items-center gap-2 py-0.5 text-xs text-zinc-900"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => void toggleArtist(a.id)}
                      className="h-3.5 w-3.5 accent-zinc-900"
                    />
                    <span className="w-4 shrink-0 text-center text-sm" aria-hidden>
                      {myTierEmoji(group, a.id, session.memberId)}
                    </span>
                    <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
                      {disambigName(a)}
                    </span>
                    {onPlan ? (
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                        plan
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
            {setlistArtistIds.length > SETLIST_ARTIST_CAP ? (
              <p className="mt-2 text-xs text-amber-900">
                Max {SETLIST_ARTIST_CAP} artists.
              </p>
            ) : null}
          </div>
        ) : null}

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

        {showWaitNote ? (
          <p className="text-xs text-zinc-600">This could take a moment!</p>
        ) : null}

        {err ? (
          <p className="border-2 border-red-800 bg-red-50 px-2 py-1.5 text-xs text-red-900">
            {err}
          </p>
        ) : null}

        {playlistUrl ? (
          <p className="text-xs text-zinc-900">
            <a
              href={playlistUrl}
              className="font-medium text-indigo-700 underline"
              target="_blank"
              rel="noreferrer"
            >
              Open in Spotify
            </a>
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
