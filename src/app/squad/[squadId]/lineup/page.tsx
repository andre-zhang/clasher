"use client";

import { useRef, useState } from "react";

import { useClasher } from "@/context/ClasherContext";
import type { FestivalSnapshot, RatingTier } from "@/lib/types";

const TIERS: { id: RatingTier; label: string }[] = [
  { id: "must", label: "Must" },
  { id: "want", label: "Want" },
  { id: "maybe", label: "Maybe" },
  { id: "skip", label: "Skip" },
];

export default function LineupPage() {
  const {
    session,
    group,
    setRating,
    addComment,
    commitLineupNames,
    loadDemoLineup,
    parseLineupFile,
  } = useClasher();
  const [draftNames, setDraftNames] = useState<string[] | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
    setBusy(true);
    try {
      const names = await parseLineupFile(f);
      setDraftNames(names);
    } catch (err) {
      setParseErr(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function commitScan() {
    if (!draftNames?.length) return;
    setBusy(true);
    setParseErr(null);
    try {
      await commitLineupNames(draftNames);
      setDraftNames(null);
    } catch (err) {
      setParseErr(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Lineup</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Vote per act, add notes, or scan a poster (server needs vision API
          keys).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void loadDemoLineup()}
          className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
        >
          Load demo lineup
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
        >
          Scan poster image
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
        <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {parseErr}
        </p>
      ) : null}

      {draftNames && draftNames.length > 0 ? (
        <div className="rounded-xl border border-violet-900/50 bg-violet-950/20 p-4">
          <p className="text-sm font-medium text-violet-200">
            Review scanned names ({draftNames.length})
          </p>
          <ul className="mt-2 max-h-40 list-inside list-disc overflow-y-auto text-sm text-zinc-300">
            {draftNames.slice(0, 40).map((n) => (
              <li key={n}>{n}</li>
            ))}
            {draftNames.length > 40 ? (
              <li className="text-zinc-500">…</li>
            ) : null}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void commitScan()}
              disabled={busy}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              Add to squad lineup
            </button>
            <button
              type="button"
              onClick={() => setDraftNames(null)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      <ul className="space-y-4">
        {group.artists.map((a) => (
          <li
            key={a.id}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold text-zinc-100">{a.name}</h2>
                <ArtistComments artistId={a.id} group={group} onAdd={addComment} />
              </div>
              <div className="flex flex-wrap gap-1">
                {TIERS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => void setRating(a.id, t.id)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                      myRatings.get(a.id) === t.id
                        ? "bg-violet-600 text-white"
                        : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ArtistComments({
  artistId,
  group,
  onAdd,
}: {
  artistId: string;
  group: FestivalSnapshot;
  onAdd: (artistId: string, body: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const comments = group.comments.filter((c) => c.artistId === artistId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const b = text.trim();
    if (!b) return;
    setSaving(true);
    try {
      await onAdd(artistId, b);
      setText("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2">
      {comments.length > 0 ? (
        <ul className="space-y-1 text-xs text-zinc-500">
          {comments.map((c) => {
            const author = group.members.find((m) => m.id === c.memberId);
            return (
              <li key={c.id}>
                <span className="text-zinc-400">
                  {author?.displayName ?? "Someone"}:
                </span>{" "}
                {c.body}
              </li>
            );
          })}
        </ul>
      ) : null}
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
          placeholder="Note for the squad…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          disabled={saving || !text.trim()}
          className="rounded bg-zinc-700 px-2 py-1 text-xs text-white disabled:opacity-40"
        >
          Add
        </button>
      </form>
    </div>
  );
}
