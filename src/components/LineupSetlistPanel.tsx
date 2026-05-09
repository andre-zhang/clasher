"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useClasher } from "@/context/ClasherContext";
import {
  apiSetlistPreview,
  apiSetlistSpotifyFromRows,
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
import type { FestivalSnapshot } from "@/lib/types";

/** When lineup has duplicate names (different ids), map any id to the single id we show in the picker. */
function canonicalSetlistArtistIds(
  group: FestivalSnapshot,
  pickList: { id: string; name: string }[]
): Map<string, string> {
  const nameKey = (n: string) => n.trim().toLowerCase();
  const canonicalByName = new Map(pickList.map((a) => [nameKey(a.name), a.id]));
  const out = new Map<string, string>();
  for (const a of group.artists) {
    const canon = canonicalByName.get(nameKey(a.name));
    if (canon) out.set(a.id, canon);
  }
  return out;
}

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

  /**
   * One row per billing name: lineup imports sometimes duplicate the same act with different ids.
   * Fuzzy matching still runs on the server; the picker only shows one checkbox per display name.
   */
  const artistsForPickUi = useMemo(() => {
    if (!group?.artists?.length) return [];
    const sorted = [...group.artists].sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
    const byNormName = new Map<string, { id: string; name: string; sortOrder: number }>();
    for (const a of sorted) {
      const k = a.name.trim().toLowerCase();
      if (!byNormName.has(k)) byNormName.set(k, a);
    }
    return [...byNormName.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [group?.artists]);

  const collapseIdsToCanonical = useCallback(
    (ids: string[]): string[] => {
      if (!group?.artists.length) return ids;
      const pick = artistsForPickUi;
      if (!pick.length) return ids;
      const idMap = canonicalSetlistArtistIds(group, pick);
      const seen = new Set<string>();
      const out: string[] = [];
      for (const id of ids) {
        const c = idMap.get(id) ?? id;
        if (!pick.some((a) => a.id === c)) continue;
        if (seen.has(c)) continue;
        seen.add(c);
        out.push(c);
        if (out.length >= SETLIST_ARTIST_CAP) break;
      }
      return out;
    },
    [group, artistsForPickUi]
  );

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
            setSetlistArtistIds(
              collapseIdsToCanonical(filtered).slice(0, SETLIST_ARTIST_CAP)
            );
            return;
          }
        }
      }
    } catch {
      /* ignore */
    }
    setSetlistArtistIds(collapseIdsToCanonical(sug).slice(0, SETLIST_ARTIST_CAP));
  }, [group, session, collapseIdsToCanonical]);

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
      if (!preview?.combined.length) {
        setErr("Run Build first.");
        return;
      }
      const o = await apiSetlistSpotifyFromRows(session, { rows: preview.combined });
      setPlaylistUrl(o.playlistUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPlaylistBusy(false);
    }
  }, [session, setlistArtistIds, preview]);

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
      collapseIdsToCanonical(suggestedSetlistArtistIds(group, session.memberId)).slice(
        0,
        SETLIST_ARTIST_CAP
      )
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
  return (
    <details className="border-2 border-zinc-900 bg-zinc-50 shadow-[2px_2px_0_0_#18181b]">
      <summary className="cursor-pointer select-none border-b-2 border-violet-200 bg-violet-50/90 px-3 py-2 text-sm font-semibold text-violet-950">
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
                className="touch-manipulation border-2 border-violet-700 bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-950 hover:bg-violet-200"
              >
                My picks
              </button>
              <button
                type="button"
                onClick={pickNone}
                className="touch-manipulation border-2 border-zinc-900 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-800"
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
                      className="h-3.5 w-3.5 accent-violet-700"
                    />
                    <span className="w-4 shrink-0 text-center text-sm" aria-hidden>
                      {myTierEmoji(group, a.id, session.memberId)}
                    </span>
                    <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
                      {a.name}
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
            className="touch-manipulation border-2 border-violet-900 bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[2px_2px_0_0_#4c1d95] hover:bg-violet-700 disabled:opacity-40"
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
              className="touch-manipulation border-2 border-violet-900 bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-950 shadow-[2px_2px_0_0_#4c1d95] hover:bg-violet-200 disabled:opacity-40"
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

        {preview?.selectionWarnings?.length ? (
          <ul className="list-inside list-disc border-2 border-amber-800 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
            {preview.selectionWarnings.map((w, i) => (
              <li key={`${i}-${w}`}>{w}</li>
            ))}
          </ul>
        ) : null}

        {playlistUrl ? (
          <p className="text-xs text-zinc-900">
            <a
              href={playlistUrl}
              className="font-medium text-violet-800 underline decoration-violet-400"
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
                className="touch-manipulation border-2 border-violet-800 bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-950 hover:bg-violet-100"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={copyTsv}
                className="touch-manipulation border-2 border-violet-300 bg-white px-2 py-1 text-xs font-medium text-violet-900 hover:bg-violet-50"
              >
                Copy TSV
              </button>
            </div>

            <div className="max-h-80 overflow-auto overflow-x-auto border-2 border-zinc-900 bg-white">
              <table className="w-full min-w-[16rem] border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-violet-100/80">
                    <th className="border-b border-violet-300 px-2 py-1 font-semibold text-violet-950">
                      Artist
                    </th>
                    <th className="border-b border-violet-300 px-2 py-1 font-semibold text-violet-950">
                      Song
                    </th>
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
