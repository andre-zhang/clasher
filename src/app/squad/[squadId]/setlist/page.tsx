"use client";

import { useCallback, useMemo, useState } from "react";

import { useClasher } from "@/context/ClasherContext";
import { apiSetlistPreview } from "@/lib/api";
import type { FestivalSnapshot } from "@/lib/types";
import type { SetlistPreviewResult } from "@/lib/setlistPreviewTypes";

function artistName(group: FestivalSnapshot, artistId: string): string {
  return (
    group.artists.find((a) => a.id === artistId)?.name ??
    group.schedule.find((s) => s.artistId === artistId)?.artistName ??
    "Unknown"
  );
}

function eligibleArtistIds(
  group: FestivalSnapshot,
  memberId: string
): { id: string; name: string; source: string }[] {
  const out: { id: string; name: string; source: string }[] = [];
  const seen = new Set<string>();
  for (const r of group.ratings ?? []) {
    if (r.memberId !== memberId) continue;
    if (r.tier !== "must" && r.tier !== "want") continue;
    if (seen.has(r.artistId)) continue;
    seen.add(r.artistId);
    out.push({ id: r.artistId, name: artistName(group, r.artistId), source: "lineup" });
  }
  for (const s of group.schedule) {
    const i = group.memberSlotIntents.find((x) => x.slotId === s.id);
    if (!i?.wants) continue;
    if (seen.has(s.artistId)) continue;
    seen.add(s.artistId);
    out.push({ id: s.artistId, name: s.artistName, source: "plan" });
  }
  return out;
}

export default function SetlistPage() {
  const { session, group } = useClasher();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<SetlistPreviewResult | null>(null);
  const [maxSetlists, setMaxSetlists] = useState(4);
  const [maxSpotify, setMaxSpotify] = useState(50);

  const eligible = useMemo(() => {
    if (!group || !session) return [];
    return eligibleArtistIds(group, session.memberId);
  }, [group, session]);

  const run = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setErr(null);
    try {
      const p = await apiSetlistPreview(session, {
        maxSetlistsPerArtist: maxSetlists,
        maxSpotifyLookups: maxSpotify,
      });
      setPreview(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, [session, maxSetlists, maxSpotify]);

  if (!group || !session) return null;

  const copyPlain = () => {
    if (!preview?.combined.length) return;
    const t = preview.combined
      .map((r) => `${r.artistName} — ${r.title}`)
      .join("\n");
    void navigator.clipboard.writeText(t);
  };

  const copyTsv = () => {
    if (!preview?.combined.length) return;
    const t = ["artist\ttitle\tweight", ...preview.combined.map(
        (r) => `${r.artistName}\t${r.title}\t${r.count}`
      )].join("\n");
    void navigator.clipboard.writeText(t);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-zinc-900">Festival setlist (v1)</h1>
      <p className="max-w-2xl text-sm text-zinc-700">
        For every artist you <span className="whitespace-nowrap">❤️/🔥</span> on{" "}
        <strong>Lineup</strong> or have on your <strong>Plan</strong>, we pull
        recent shows from <strong>setlist.fm</strong> and count how often each
        song appeared. It is a <em>hint</em> for what they might play — not the
        real festival set.
      </p>

      <section className="border-2 border-zinc-900 bg-indigo-50/30 p-4 shadow-[2px_2px_0_0_#18181b]">
        <p className="text-sm font-semibold text-zinc-900">Your artists (sources)</p>
        {eligible.length ? (
          <ul className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-800">
            {eligible.map((a) => (
              <li
                key={a.id}
                className="border border-zinc-700 bg-white px-2 py-1"
                title={a.source === "plan" ? "On your plan" : "Lineup tier"}
              >
                {a.name}
                <span className="ml-1 text-zinc-500">
                  ({a.source === "plan" ? "plan" : "lineup"})
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-zinc-600">
            No one yet — add ❤️/🔥 on Lineup and/or add acts to your plan on
            Schedule / Plans.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <label className="block">
            <span className="text-xs font-medium text-zinc-600">
              Past shows per artist
            </span>
            <input
              type="number"
              min={1}
              max={8}
              className="mt-0.5 w-20 border-2 border-zinc-900 px-2 py-1"
              value={maxSetlists}
              onChange={(e) =>
                setMaxSetlists(Math.max(1, Math.min(8, Number(e.target.value) || 1)))
              }
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-600">
              Spotify link lookups
            </span>
            <input
              type="number"
              min={0}
              max={100}
              className="mt-0.5 w-20 border-2 border-zinc-900 px-2 py-1"
              value={maxSpotify}
              onChange={(e) =>
                setMaxSpotify(
                  Math.max(0, Math.min(100, Number(e.target.value) || 0))
                )
              }
            />
          </label>
          <button
            type="button"
            disabled={busy || !eligible.length}
            onClick={() => void run()}
            className="touch-manipulation border-2 border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Fetching…" : "Build preview"}
          </button>
        </div>
      </section>

      {err ? (
        <p className="border-2 border-red-800 bg-red-50 px-3 py-2 text-sm text-red-900">
          {err}
        </p>
      ) : null}

      {preview && !preview.setlistfmConfigured ? (
        <p className="border-2 border-amber-800 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <strong>setlist.fm</strong> is not configured. Add{" "}
          <code className="rounded bg-white px-1">SETLISTFM_API_KEY</code> to the
          server env (get a key at{" "}
          <a
            href="https://www.setlist.fm/settings/api"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            setlist.fm → Settings → API
          </a>
          ).
        </p>
      ) : null}

      {preview?.spotifySearchConfigured === false && preview.setlistfmConfigured ? (
        <p className="text-xs text-zinc-600">
          Optional: add{" "}
          <code className="rounded border border-zinc-400 px-1">SPOTIFY_CLIENT_ID</code>{" "}
          and{" "}
          <code className="rounded border border-zinc-400 px-1">
            SPOTIFY_CLIENT_SECRET
          </code>{" "}
          for &quot;Open in Spotify&quot; links (search API, not playlist write).
        </p>
      ) : null}

      {preview && preview.combined.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyPlain}
              className="border-2 border-zinc-900 bg-white px-2 py-1 text-xs font-medium"
            >
              Copy &quot;Artist — Song&quot; list
            </button>
            <button
              type="button"
              onClick={copyTsv}
              className="border-2 border-zinc-900 bg-white px-2 py-1 text-xs font-medium"
            >
              Copy TSV (paste into sheets)
            </button>
          </div>

          <div className="overflow-x-auto border-2 border-zinc-900 bg-white">
            <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-zinc-100">
                  <th className="border-b border-zinc-400 px-2 py-1.5">Artist</th>
                  <th className="border-b border-zinc-400 px-2 py-1.5">Song</th>
                  <th className="border-b border-zinc-400 px-2 py-1.5">Weight</th>
                  <th className="border-b border-zinc-400 px-2 py-1.5">Spotify</th>
                  <th className="border-b border-zinc-400 px-2 py-1.5">YouTube</th>
                </tr>
              </thead>
              <tbody>
                {preview.combined.map((r) => (
                  <tr key={r.key} className="border-b border-zinc-200">
                    <td className="px-2 py-1 align-top [overflow-wrap:anywhere]">
                      {r.artistName}
                    </td>
                    <td className="px-2 py-1 align-top [overflow-wrap:anywhere]">
                      {r.title}
                    </td>
                    <td className="px-2 py-1 text-zinc-600">{r.count}</td>
                    <td className="px-2 py-1">
                      {r.spotifyUrl ? (
                        <a
                          href={r.spotifyUrl}
                          className="text-indigo-700 underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
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

      {preview && preview.artists.some((a) => a.error) ? (
        <details className="text-xs text-zinc-600">
          <summary className="cursor-pointer font-medium">Per-artist messages</summary>
          <ul className="mt-1 list-inside list-disc">
            {preview.artists
              .filter((a) => a.error)
              .map((a) => (
                <li key={a.artistId}>
                  {a.name}: {a.error}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
