"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ScanningOverlay } from "@/components/ScanningOverlay";
import { useClasher } from "@/context/ClasherContext";
import { normalizeImportedArtistNames } from "@/lib/importNormalize";
import {
  compactSquadTierStrip,
  myTierEmoji,
} from "@/lib/reactionsUi";
import { TIER_EMOJI, TIERS_ORDER, tierFromString } from "@/lib/tiers";
import type { FestivalSnapshot, RatingTier } from "@/lib/types";

const TIERS: RatingTier[] = ["must", "want", "maybe", "skip"];

export default function LineupPage() {
  const {
    session,
    group,
    setRating,
    addComment,
    commitLineupNames,
    parseLineupFile,
  } = useClasher();
  const [draftNames, setDraftNames] = useState<string[] | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const artistsSorted = useMemo(
    () =>
      !group?.artists?.length
        ? []
        : [...group.artists].sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
          ),
    [group?.artists]
  );

  if (!group || !session) return null;

  const myRatings = new Map(
    group.ratings
      .filter((r) => r.memberId === session.memberId)
      .map((r) => [r.artistId, r.tier as RatingTier])
  );

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setParseErr(null);
    setScanning(true);
    setBusy(true);
    try {
      const names = await parseLineupFile(f);
      setDraftNames(normalizeImportedArtistNames(names));
    } catch (err) {
      setParseErr(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
      setBusy(false);
    }
  }

  async function commitScan() {
    const cleaned =
      draftNames?.map((s) => s.trim()).filter((s) => s.length > 0) ?? [];
    if (!cleaned.length) return;
    setBusy(true);
    setParseErr(null);
    try {
      await commitLineupNames(cleaned);
      setDraftNames(null);
    } catch (err) {
      setParseErr(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const detailArtist = detailId
    ? group.artists.find((a) => a.id === detailId)
    : null;

  return (
    <div className="space-y-6">
      {scanning ? <ScanningOverlay label="Scanning poster…" /> : null}

      <h1 className="text-xl font-bold text-zinc-900">Lineup</h1>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="border-2 border-zinc-900 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white shadow-[2px_2px_0_0_#18181b] hover:bg-zinc-800 disabled:opacity-50"
        >
          Scan poster
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFile}
        />
      </div>

      {parseErr ? (
        <p className="border-2 border-red-800 bg-red-50 px-3 py-2 text-sm text-red-900">
          {parseErr}
        </p>
      ) : null}

      {draftNames && draftNames.length > 0 ? (
        <div className="border-2 border-zinc-900 bg-indigo-50 p-4 shadow-[3px_3px_0_0_#18181b]">
          <p className="text-sm font-semibold text-zinc-900">
            Edit before commit ({draftNames.length})
          </p>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-sm">
            {draftNames.map((n, i) => (
              <li key={i} className="flex gap-1">
                <input
                  className="min-w-0 flex-1 border-2 border-zinc-900 bg-white px-2 py-1 text-sm"
                  value={n}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDraftNames((prev) => {
                      if (!prev) return prev;
                      const next = [...prev];
                      next[i] = v;
                      return next;
                    });
                  }}
                />
                <button
                  type="button"
                  className="shrink-0 border-2 border-zinc-900 bg-white px-2 text-xs"
                  onClick={() =>
                    setDraftNames((prev) =>
                      prev ? prev.filter((_, j) => j !== i) : prev
                    )
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                setDraftNames((prev) => [...(prev ?? []), ""])
              }
              className="border-2 border-zinc-900 bg-white px-2 py-1 text-xs font-medium"
            >
              Add name
            </button>
            <button
              type="button"
              onClick={() => void commitScan()}
              disabled={busy}
              className="border-2 border-zinc-900 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[2px_2px_0_0_#18181b] disabled:opacity-50"
            >
              Add to lineup
            </button>
            <button
              type="button"
              onClick={() => setDraftNames(null)}
              className="text-xs text-zinc-600 underline"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      <ul className="space-y-2">
        {artistsSorted.map((a) => (
          <li
            key={a.id}
            className="flex flex-col gap-2 border-2 border-zinc-900 bg-white p-3 shadow-[2px_2px_0_0_#18181b] sm:flex-row sm:items-center sm:justify-between"
          >
            <button
              type="button"
              onClick={() => setDetailId(a.id)}
              className="min-w-0 flex-1 text-left hover:opacity-80"
            >
              <h2 className="font-semibold text-zinc-900">{a.name}</h2>
              <p
                className="mt-1 truncate text-[10px] text-zinc-600"
                title={`You ${myTierEmoji(group, a.id, session.memberId)} · Others ${compactSquadTierStrip(group, a.id, session.memberId)}`}
              >
                <span className="font-semibold text-zinc-800">You</span>{" "}
                {myTierEmoji(group, a.id, session.memberId)}
                <span className="text-zinc-400"> · </span>
                <span className="font-semibold text-zinc-800">Others</span>{" "}
                {compactSquadTierStrip(group, a.id, session.memberId)}
              </p>
            </button>
            <div className="flex flex-wrap gap-1">
              {TIERS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => void setRating(a.id, t)}
                  className={`border-2 px-2 py-1 text-sm ${
                    myRatings.get(a.id) === t
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-900 bg-white text-zinc-900"
                  }`}
                  title={t}
                >
                  {TIER_EMOJI[t]}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {detailArtist ? (
        <ArtistDetailDialog
          artist={detailArtist}
          group={group}
          myId={session.memberId}
          onClose={() => setDetailId(null)}
          onAddComment={addComment}
        />
      ) : null}
    </div>
  );
}

function ArtistDetailDialog({
  artist,
  group,
  myId,
  onClose,
  onAddComment,
}: {
  artist: { id: string; name: string };
  group: FestivalSnapshot;
  myId: string;
  onClose: () => void;
  onAddComment: (artistId: string, body: string) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  function open() {
    dialogRef.current?.showModal();
  }

  useEffect(() => {
    open();
  }, []);

  const comments = group.comments
    .filter((c) => c.artistId === artist.id)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const b = text.trim();
    if (!b) return;
    setSaving(true);
    try {
      await onAddComment(artist.id, b);
      setText("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="max-h-[85vh] w-[min(100%,28rem)] border-2 border-zinc-900 bg-white p-0 shadow-[6px_6px_0_0_#18181b] backdrop:bg-black/30"
      onClose={onClose}
    >
      <div className="max-h-[85vh] overflow-y-auto p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold text-zinc-900">{artist.name}</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="border-2 border-zinc-900 bg-white px-2 py-0.5 text-xs font-bold"
          >
            ✕
          </button>
        </div>

        <p className="mt-2 text-xs text-zinc-600">
          Group votes:{" "}
          {TIERS_ORDER.map((t) => {
            const n = group.ratings.filter(
              (r) =>
                r.artistId === artist.id && tierFromString(r.tier) === t
            ).length;
            return n > 0 ? (
              <span key={t} className="mr-2 inline-block">
                {TIER_EMOJI[t]}
                {n}
              </span>
            ) : null;
          })}
        </p>

        <ul className="mt-4 space-y-2 border-t-2 border-zinc-200 pt-3">
          {group.members.map((m) => {
            const r = group.ratings.find(
              (x) => x.memberId === m.id && x.artistId === artist.id
            );
            const t = r ? tierFromString(r.tier) : null;
            return (
              <li key={m.id} className="flex justify-between text-sm">
                <span className="text-zinc-800">
                  {m.displayName}
                  {m.id === myId ? " (you)" : ""}
                </span>
                <span>{t ? TIER_EMOJI[t] : "—"}</span>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 border-t-2 border-zinc-200 pt-3">
          <p className="text-xs font-bold uppercase text-zinc-500">Notes</p>
          <ul className="mt-2 space-y-2 text-sm text-zinc-800">
            {comments.map((c) => {
              const author = group.members.find((m) => m.id === c.memberId);
              return (
                <li key={c.id} className="border border-zinc-200 p-2">
                  <span className="text-xs font-semibold text-zinc-600">
                    {author?.displayName ?? "?"}{" "}
                    <span className="font-mono font-normal text-zinc-400">
                      {new Date(c.createdAt).toLocaleString()}
                    </span>
                  </span>
                  <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                </li>
              );
            })}
          </ul>
          <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
            <textarea
              className="min-h-[72px] w-full border-2 border-zinc-900 px-2 py-1 text-sm"
              placeholder="Note"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              type="submit"
              disabled={saving || !text.trim()}
              className="border-2 border-zinc-900 bg-indigo-600 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Add note
            </button>
          </form>
        </div>
      </div>
    </dialog>
  );
}
