"use client";

import { useMemo, useState } from "react";

import { useClasher } from "@/context/ClasherContext";
import { findMyResolution, findOverlappingPairs } from "@/lib/clash";
import type { FestivalSnapshot } from "@/lib/types";

export default function ClashesPage() {
  const { session, group, setConflict, putSlotIntents } = useClasher();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pairs = useMemo(
    () => (group ? findOverlappingPairs(group.schedule) : []),
    [group]
  );

  if (!group || !session) return null;

  async function savePair(
    slotAId: string,
    slotBId: string,
    choice: string | null,
    planNote: string,
    individualOnly: boolean
  ) {
    setErr(null);
    setBusy(true);
    try {
      await setConflict(
        slotAId,
        slotBId,
        choice,
        planNote.trim() || null,
        individualOnly
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function syncWantsFromLineup() {
    const g = group;
    const me = session;
    if (!g?.schedule.length || !me) return;
    const wantsIds = new Set(
      g.schedule
        .filter((slot) => {
          const tier = g.ratings.find(
            (r) => r.memberId === me.memberId && r.artistId === slot.artistId
          )?.tier;
          return tier === "must" || tier === "want";
        })
        .map((s) => s.id)
    );
    const intents = g.schedule.map((s) => ({
      slotId: s.id,
      wants: wantsIds.has(s.id),
    }));
    setBusy(true);
    setErr(null);
    try {
      await putSlotIntents(intents);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Clashes</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Overlapping sets on the same day (by time). Pick which set you are
          taking, add a note, or mark as individual-only.
        </p>
      </div>

      <button
        type="button"
        disabled={busy || !group.schedule.length}
        onClick={() => void syncWantsFromLineup()}
        className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
      >
        Set “want” flags from my Must/Want votes
      </button>

      {err ? (
        <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {err}
        </p>
      ) : null}

      {pairs.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {group.schedule.length < 2
            ? "Add at least two slots to detect clashes."
            : "No overlapping slots detected (same day + overlapping times)."}
        </p>
      ) : (
        <ul className="space-y-6">
          {pairs.map(({ a, b }) => (
            <ClashCard
              key={`${a.id}-${b.id}`}
              a={a}
              b={b}
              myMemberId={session.memberId}
              group={group}
              busy={busy}
              onSave={savePair}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ClashCard({
  a,
  b,
  myMemberId,
  group,
  busy,
  onSave,
}: {
  a: FestivalSnapshot["schedule"][0];
  b: FestivalSnapshot["schedule"][0];
  myMemberId: string;
  group: FestivalSnapshot;
  busy: boolean;
  onSave: (
    slotAId: string,
    slotBId: string,
    choice: string | null,
    planNote: string,
    individualOnly: boolean
  ) => Promise<void>;
}) {
  const existing = findMyResolution(group, myMemberId, a.id, b.id);
  const [choice, setChoice] = useState<string | null>(
    existing?.choice ?? null
  );
  const [note, setNote] = useState(existing?.planNote ?? "");
  const [indiv, setIndiv] = useState(existing?.individualOnly ?? false);

  const others = group.conflictResolutions.filter(
    (c) =>
      c.memberId !== myMemberId &&
      ((c.slotAId === a.id && c.slotBId === b.id) ||
        (c.slotAId === b.id && c.slotBId === a.id))
  );

  return (
    <li className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-zinc-950/80 p-3 text-sm">
          <p className="font-medium text-violet-300">Set A</p>
          <p className="text-zinc-200">{a.artistName}</p>
          <p className="text-xs text-zinc-500">
            {a.dayLabel} · {a.stageName} · {a.start}–{a.end}
          </p>
        </div>
        <div className="rounded-lg bg-zinc-950/80 p-3 text-sm">
          <p className="font-medium text-violet-300">Set B</p>
          <p className="text-zinc-200">{b.artistName}</p>
          <p className="text-xs text-zinc-500">
            {b.dayLabel} · {b.stageName} · {b.start}–{b.end}
          </p>
        </div>
      </div>

      {others.length > 0 ? (
        <div className="mt-3 text-xs text-zinc-500">
          <p className="font-medium text-zinc-400">Friends</p>
          <ul className="mt-1 space-y-1">
            {others.map((c) => {
              const m = group.members.find((x) => x.id === c.memberId);
              const picked =
                c.choice === a.id ? a.artistName : c.choice === b.id ? b.artistName : "—";
              return (
                <li key={c.memberId}>
                  {m?.displayName ?? "Member"}: {picked}
                  {c.individualOnly ? " (individual)" : ""}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        <p className="text-xs font-medium text-zinc-400">Your pick</p>
        <div className="flex flex-wrap gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`pick-${a.id}-${b.id}`}
              checked={choice === a.id}
              onChange={() => setChoice(a.id)}
            />
            {a.artistName}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`pick-${a.id}-${b.id}`}
              checked={choice === b.id}
              onChange={() => setChoice(b.id)}
            />
            {b.artistName}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`pick-${a.id}-${b.id}`}
              checked={choice === null}
              onChange={() => setChoice(null)}
            />
            Undecided
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={indiv}
            onChange={(e) => setIndiv(e.target.checked)}
          />
          I might split from the squad for this clash
        </label>
        <input
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
          placeholder="Plan note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void onSave(a.id, b.id, choice, note, indiv)}
          className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
        >
          Save my choice
        </button>
      </div>
    </li>
  );
}
