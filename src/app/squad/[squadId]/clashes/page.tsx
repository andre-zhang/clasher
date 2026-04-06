"use client";

import { useMemo, useRef, useState } from "react";

import { useClasher } from "@/context/ClasherContext";
import {
  describeConflictResolution,
  findMyResolution,
  findUnresolvedOverlappingPairs,
} from "@/lib/clash";
import { findSquadClashDefault } from "@/lib/effectiveIntents";
import type { ConflictPlanPayload } from "@/lib/api";
import { buildSlotIntentsFromHotRatings } from "@/lib/syncIntentsFromRatings";
import type { FestivalSnapshot } from "@/lib/types";

export default function ClashesPage() {
  const { session, group, setConflict, putSlotIntents } = useClasher();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pairs = useMemo(
    () =>
      group && session
        ? findUnresolvedOverlappingPairs(group, session.memberId)
        : [],
    [group, session]
  );

  if (!group || !session) return null;

  const snap = group;
  const me = session;

  async function run(save: () => Promise<void>) {
    setErr(null);
    setBusy(true);
    try {
      await save();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function syncHotFlags() {
    if (!snap.schedule.length) return;
    await run(() =>
      putSlotIntents(buildSlotIntentsFromHotRatings(snap, me.memberId))
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-zinc-900">Clashes</h1>

      <button
        type="button"
        disabled={busy || !group.schedule.length}
        onClick={() => void syncHotFlags()}
        className="border-2 border-zinc-900 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 shadow-[2px_2px_0_0_#18181b] hover:bg-zinc-100 disabled:opacity-40"
      >
        Sync ❤️/🔥 → slot flags
      </button>

      {err ? (
        <p className="border-2 border-red-800 bg-red-50 px-3 py-2 text-sm text-red-900">
          {err}
        </p>
      ) : null}

      {pairs.length === 0 ? (
        <p className="text-sm text-zinc-600">
          {group.schedule.length < 2
            ? "Need at least two slots."
            : "Nothing to resolve right now."}
        </p>
      ) : (
        <ul className="space-y-4">
          {pairs.map(({ a, b }) => (
            <ClashCard
              key={`${a.id}-${b.id}`}
              a={a}
              b={b}
              myMemberId={session.memberId}
              group={group}
              busy={busy}
              onSave={(p) => run(() => setConflict(p))}
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
  onSave: (p: ConflictPlanPayload) => Promise<void>;
}) {
  const existing = findMyResolution(group, myMemberId, a.id, b.id);
  const [note, setNote] = useState(existing?.planNote ?? "");

  const [branch, setBranch] = useState<"group" | "split" | null>(() => {
    if (!existing) return null;
    if (existing.planMode === "group") return "group";
    if (
      existing.planMode === "pick" ||
      existing.planMode === "split_seq" ||
      existing.planMode === "custom" ||
      (existing.choice != null && existing.choice !== "")
    ) {
      return "split";
    }
    return null;
  });

  const [splitMode, setSplitMode] = useState<
    "pick_a" | "pick_b" | "ab" | "ba" | "custom" | null
  >(() => {
    if (!existing || existing.planMode === "group") return null;
    if (existing.planMode === "pick" && existing.choice === a.id) return "pick_a";
    if (existing.planMode === "pick" && existing.choice === b.id) return "pick_b";
    if (
      existing.planMode === "split_seq" &&
      existing.splitFirstSlotId === a.id &&
      existing.splitSecondSlotId === b.id
    )
      return "ab";
    if (
      existing.planMode === "split_seq" &&
      existing.splitFirstSlotId === b.id &&
      existing.splitSecondSlotId === a.id
    )
      return "ba";
    if (existing.planMode === "custom") return "custom";
    if (existing.choice === a.id) return "pick_a";
    if (existing.choice === b.id) return "pick_b";
    return null;
  });

  const ia = group.memberSlotIntents.find((i) => i.slotId === a.id);
  const ib = group.memberSlotIntents.find((i) => i.slotId === b.id);
  const [cFromA, setCFromA] = useState(ia?.planFrom ?? a.start);
  const [cToA, setCToA] = useState(ia?.planTo ?? a.end);
  const [cFromB, setCFromB] = useState(ib?.planFrom ?? b.start);
  const [cToB, setCToB] = useState(ib?.planTo ?? b.end);

  const [groupLean, setGroupLean] = useState<null | "a" | "b">(() => {
    if (!existing?.groupLeanSlotId) return null;
    if (existing.groupLeanSlotId === a.id) return "a";
    if (existing.groupLeanSlotId === b.id) return "b";
    return null;
  });

  const squadDef = findSquadClashDefault(group, a.id, b.id);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const [squadDefaultMode, setSquadDefaultMode] = useState<
    "none" | "set_a" | "set_b"
  >("none");
  const [pendingGroupSave, setPendingGroupSave] =
    useState<ConflictPlanPayload | null>(null);

  const others = group.conflictResolutions.filter(
    (c) =>
      c.memberId !== myMemberId &&
      ((c.slotAId === a.id && c.slotBId === b.id) ||
        (c.slotAId === b.id && c.slotBId === a.id))
  );

  function payloadForSplitChoice(
    mode: typeof splitMode
  ): ConflictPlanPayload | null {
    const base = {
      slotAId: a.id,
      slotBId: b.id,
      planNote: note.trim() || null,
    } satisfies Partial<ConflictPlanPayload>;
    if (mode === "pick_a")
      return { ...base, planMode: "pick" as const, choice: a.id };
    if (mode === "pick_b")
      return { ...base, planMode: "pick" as const, choice: b.id };
    if (mode === "ab")
      return {
        ...base,
        planMode: "split_seq" as const,
        splitOrderSlotIds: [a.id, b.id] as [string, string],
      };
    if (mode === "ba")
      return {
        ...base,
        planMode: "split_seq" as const,
        splitOrderSlotIds: [b.id, a.id] as [string, string],
      };
    if (mode === "custom") {
      return {
        ...base,
        planMode: "custom" as const,
        customWindows: [
          { slotId: a.id, planFrom: cFromA.trim(), planTo: cToA.trim() },
          { slotId: b.id, planFrom: cFromB.trim(), planTo: cToB.trim() },
        ],
      };
    }
    return null;
  }

  function buildGroupPayload(
    opts: { squadDefaultChoiceSlotId?: string; clearSquadDefault?: boolean } = {}
  ): ConflictPlanPayload {
    return {
      slotAId: a.id,
      slotBId: b.id,
      planMode: "group",
      planNote: note.trim() || null,
      groupLeanSlotId:
        groupLean === "a" ? a.id : groupLean === "b" ? b.id : null,
      ...opts,
    };
  }

  function openGroupSave() {
    if (squadDefaultMode === "set_a" || squadDefaultMode === "set_b") {
      const choice = squadDefaultMode === "set_a" ? a.id : b.id;
      setPendingGroupSave(
        buildGroupPayload({ squadDefaultChoiceSlotId: choice })
      );
      confirmRef.current?.showModal();
    } else {
      void onSave(buildGroupPayload());
    }
  }

  return (
    <li className="border-2 border-zinc-900 bg-white p-4 shadow-[3px_3px_0_0_#18181b]">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="border-2 border-zinc-900 bg-zinc-50 p-2 text-sm">
          <p className="text-[10px] font-bold uppercase text-zinc-500">A</p>
          <p className="font-semibold text-zinc-900">{a.artistName}</p>
          <p className="font-mono text-xs text-zinc-600">
            {a.dayLabel} · {a.stageName} · {a.start}–{a.end}
          </p>
        </div>
        <div className="border-2 border-zinc-900 bg-zinc-50 p-2 text-sm">
          <p className="text-[10px] font-bold uppercase text-zinc-500">B</p>
          <p className="font-semibold text-zinc-900">{b.artistName}</p>
          <p className="font-mono text-xs text-zinc-600">
            {b.dayLabel} · {b.stageName} · {b.start}–{b.end}
          </p>
        </div>
      </div>

      {squadDef ? (
        <p className="mt-2 rounded border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-xs text-indigo-950">
          <span className="font-semibold">Squad default:</span>{" "}
          {squadDef.choiceSlotId === a.id ? a.artistName : b.artistName}
          <span className="text-indigo-700">
            {" "}
            (
            {group.members.find((m) => m.id === squadDef.setByMemberId)
              ?.displayName ?? "Someone"}
            )
          </span>
        </p>
      ) : null}

      {others.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-zinc-200 pt-2 text-xs text-zinc-700">
          {others.map((c) => {
            const m = group.members.find((x) => x.id === c.memberId);
            return (
              <li key={c.memberId}>
                <span className="font-medium">{m?.displayName ?? "?"}:</span>{" "}
                {describeConflictResolution(c, a, b)}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="mt-4 space-y-3">
        <p className="text-xs font-bold uppercase text-zinc-500">You</p>
        <input
          className="w-full border-2 border-zinc-900 bg-white px-2 py-1.5 text-sm"
          placeholder="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBranch("group");
              setSplitMode(null);
            }}
            className={`border-2 px-2 py-1 text-xs font-medium ${
              branch === "group"
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-900 bg-white text-zinc-900"
            }`}
          >
            Stay with group
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setBranch("split")}
            className={`border-2 px-2 py-1 text-xs font-medium ${
              branch === "split"
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-900 bg-white text-zinc-900"
            }`}
          >
            Split / own plan
          </button>
        </div>

        {branch === "group" ? (
          <div className="space-y-3 border-2 border-zinc-200 p-3">
            <p className="text-xs text-zinc-700">
              You follow the squad’s call. Optionally say which set you’d join if
              the group splits (doesn’t override the group—just your preference).
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setGroupLean(null)}
                className={`border-2 px-2 py-1 text-xs font-medium ${
                  groupLean === null
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-900 bg-white"
                }`}
              >
                No lean
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setGroupLean("a")}
                className={`border-2 px-2 py-1 text-xs font-medium ${
                  groupLean === "a"
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-900 bg-white"
                }`}
              >
                Lean {a.artistName}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setGroupLean("b")}
                className={`border-2 px-2 py-1 text-xs font-medium ${
                  groupLean === "b"
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-900 bg-white"
                }`}
              >
                Lean {b.artistName}
              </button>
            </div>

            <fieldset className="space-y-2 border border-zinc-200 p-2">
              <legend className="px-1 text-[10px] font-bold uppercase text-zinc-500">
                Squad default
              </legend>
              <p className="text-[11px] text-zinc-600">
                Choose whether to set the group’s pick for everyone on “stay with
                group,” or only save your own follow-group choice.
              </p>
              <label className="flex cursor-pointer items-start gap-2 text-xs">
                <input
                  type="radio"
                  name={`squad-def-${a.id}-${b.id}`}
                  checked={squadDefaultMode === "none"}
                  onChange={() => setSquadDefaultMode("none")}
                  className="mt-0.5"
                />
                <span>Don’t change the squad default</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-xs">
                <input
                  type="radio"
                  name={`squad-def-${a.id}-${b.id}`}
                  checked={squadDefaultMode === "set_a"}
                  onChange={() => setSquadDefaultMode("set_a")}
                  className="mt-0.5"
                />
                <span>
                  Set squad default: <strong>{a.artistName}</strong>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-xs">
                <input
                  type="radio"
                  name={`squad-def-${a.id}-${b.id}`}
                  checked={squadDefaultMode === "set_b"}
                  onChange={() => setSquadDefaultMode("set_b")}
                  className="mt-0.5"
                />
                <span>
                  Set squad default: <strong>{b.artistName}</strong>
                </span>
              </label>
            </fieldset>

            {squadDef ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void onSave(
                    buildGroupPayload({ clearSquadDefault: true })
                  )
                }
                className="text-xs text-zinc-600 underline hover:text-zinc-900"
              >
                Clear squad default for this clash
              </button>
            ) : null}

            <button
              type="button"
              disabled={busy}
              onClick={() => openGroupSave()}
              className="border-2 border-zinc-900 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-[2px_2px_0_0_#18181b]"
            >
              Save
            </button>
          </div>
        ) : null}

        {branch === "split" ? (
          <div className="space-y-3 border-2 border-zinc-200 p-3">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["pick_a", `All ${a.artistName}`],
                  ["pick_b", `All ${b.artistName}`],
                  ["ab", `${a.artistName} → ${b.artistName}`],
                  ["ba", `${b.artistName} → ${a.artistName}`],
                  ["custom", "Custom times"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  onClick={() => setSplitMode(id)}
                  className={`border-2 px-2 py-1 text-xs font-medium ${
                    splitMode === id
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-900 bg-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {splitMode === "custom" ? (
              <div className="grid gap-2 sm:grid-cols-2 text-xs">
                <div className="space-y-1 border border-zinc-300 p-2">
                  <p className="font-semibold">{a.artistName}</p>
                  <label className="block">
                    From
                    <input
                      className="mt-0.5 w-full border-2 border-zinc-900 px-1 font-mono"
                      value={cFromA}
                      onChange={(e) => setCFromA(e.target.value)}
                    />
                  </label>
                  <label className="block">
                    To
                    <input
                      className="mt-0.5 w-full border-2 border-zinc-900 px-1 font-mono"
                      value={cToA}
                      onChange={(e) => setCToA(e.target.value)}
                    />
                  </label>
                </div>
                <div className="space-y-1 border border-zinc-300 p-2">
                  <p className="font-semibold">{b.artistName}</p>
                  <label className="block">
                    From
                    <input
                      className="mt-0.5 w-full border-2 border-zinc-900 px-1 font-mono"
                      value={cFromB}
                      onChange={(e) => setCFromB(e.target.value)}
                    />
                  </label>
                  <label className="block">
                    To
                    <input
                      className="mt-0.5 w-full border-2 border-zinc-900 px-1 font-mono"
                      value={cToB}
                      onChange={(e) => setCToB(e.target.value)}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {splitMode ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const p = payloadForSplitChoice(splitMode);
                  if (p) void onSave(p);
                }}
                className="border-2 border-zinc-900 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-[2px_2px_0_0_#18181b]"
              >
                Save
              </button>
            ) : null}

            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void onSave({
                  slotAId: a.id,
                  slotBId: b.id,
                  planMode: null,
                  choice: null,
                  planNote: note.trim() || null,
                  individualOnly: true,
                })
              }
              className="block text-xs text-zinc-600 underline"
            >
              Clear (undecided)
            </button>
          </div>
        ) : null}
      </div>

      <dialog
        ref={confirmRef}
        className="max-w-md border-2 border-zinc-900 bg-white p-4 shadow-[4px_4px_0_0_#18181b] backdrop:bg-black/40"
        onClose={() => setPendingGroupSave(null)}
      >
        <p className="text-sm text-zinc-800">
          This makes the decision for the group: everyone who stays on “follow
          group” will use this pick for this clash until someone else sets a new
          squad default.
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="border-2 border-zinc-900 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900"
            onClick={() => confirmRef.current?.close()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="border-2 border-zinc-900 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white"
            onClick={() => {
              if (pendingGroupSave) void onSave(pendingGroupSave);
              confirmRef.current?.close();
            }}
          >
            Confirm
          </button>
        </div>
      </dialog>
    </li>
  );
}
