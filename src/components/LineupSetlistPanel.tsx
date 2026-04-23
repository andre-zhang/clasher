"use client";

import { useCallback, useMemo, useState } from "react";

import { useClasher } from "@/context/ClasherContext";
import { apiSetlistPreview } from "@/lib/api";
import type { FestivalSnapshot } from "@/lib/types";
import type { SetlistPreviewResult } from "@/lib/setlistPreviewTypes";

function hasEligibleArtists(group: FestivalSnapshot, memberId: string): boolean {
  for (const r of group.ratings ?? []) {
    if (r.memberId !== memberId) continue;
    if (r.tier === "must" || r.tier === "want") return true;
  }
  for (const s of group.schedule) {
    const i = group.memberSlotIntents.find((x) => x.slotId === s.id);
    if (i?.wants) return true;
  }
  return false;
}

export function LineupSetlistPanel() {
  const { session, group } = useClasher();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<SetlistPreviewResult | null>(null);

  const canRun = useMemo(() => {
    if (!group || !session) return false;
    return hasEligibleArtists(group, session.memberId);
  }, [group, session]);

  const run = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setErr(null);
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
        </div>

        {err ? (
          <p className="border-2 border-red-800 bg-red-50 px-2 py-1.5 text-xs text-red-900">
            {err}
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
              <table className="w-full min-w-[28rem] border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-zinc-100">
                    <th className="border-b border-zinc-400 px-2 py-1">Artist</th>
                    <th className="border-b border-zinc-400 px-2 py-1">Song</th>
                    <th className="border-b border-zinc-400 px-2 py-1">#</th>
                    <th className="border-b border-zinc-400 px-2 py-1">Spotify</th>
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
