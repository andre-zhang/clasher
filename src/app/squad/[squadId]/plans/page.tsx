"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { EveryonePlansCalendar } from "@/components/EveryonePlansCalendar";
import { PlanWallpaperExport } from "@/components/PlanWallpaperExport";
import { ScheduleCalendar } from "@/components/ScheduleCalendar";
import { useClasher } from "@/context/ClasherContext";
import {
  effectiveMemberSlotPlanWindow,
  effectiveMemberWantsSlot,
} from "@/lib/effectiveIntents";
import type { FestivalSnapshot } from "@/lib/types";

function planDetailSummary(
  group: FestivalSnapshot,
  memberId: string,
  slot: FestivalSnapshot["schedule"][0]
): { listingTime: string; listingWhere: string; planLine: string } {
  const listingTime = `${slot.start}–${slot.end}`;
  const listingWhere = `${slot.stageName} · ${slot.dayLabel}`;
  if (!effectiveMemberWantsSlot(group, memberId, slot.id)) {
    return {
      listingTime,
      listingWhere,
      planLine: "Not on your plan",
    };
  }
  const w = effectiveMemberSlotPlanWindow(group, memberId, slot);
  const planLine =
    w.planFrom && w.planTo
      ? `${w.planFrom}–${w.planTo}`
      : "Full slot (no partial window)";
  return { listingTime, listingWhere, planLine };
}

export default function PlansPage() {
  const { session, group, putSlotIntents, addSlotComment, setRating } =
    useClasher();
  const [tab, setTab] = useState<"person" | "everyone">("person");
  const [memberId, setMemberId] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [planDetailSlotId, setPlanDetailSlotId] = useState<string | null>(
    null
  );
  const [planNoteDraft, setPlanNoteDraft] = useState("");
  const [planNoteSaving, setPlanNoteSaving] = useState(false);
  const [planRemoveBusy, setPlanRemoveBusy] = useState(false);
  const [planAllowClashes, setPlanAllowClashes] = useState(false);
  const [planStripHydrateKey, setPlanStripHydrateKey] = useState(0);
  const planDetailRef = useRef<HTMLDialogElement>(null);

  const me = session?.memberId ?? null;
  const activeMember = memberId ?? me;

  const days = useMemo(() => {
    if (!group) return [];
    const d = new Set(group.schedule.map((s) => s.dayLabel.trim()));
    return [...d].sort();
  }, [group]);

  const activeDay = day ?? days[0] ?? null;

  /** Remount calendar when this member's intents change so layout matches Schedule strip / API. */
  const memberIntentsKey = useMemo(() => {
    if (!group || !activeMember) return "0";
    return group.allMemberSlotIntents
      .filter((i) => i.memberId === activeMember)
      .map(
        (i) =>
          `${i.slotId}:${i.wants ? 1 : 0}:${i.planFrom ?? ""}:${i.planTo ?? ""}`
      )
      .sort()
      .join("|");
  }, [group, activeMember]);

  const detailSlot = useMemo(
    () =>
      group && planDetailSlotId
        ? group.schedule.find((s) => s.id === planDetailSlotId) ?? null
        : null,
    [group, planDetailSlotId]
  );

  const openPlanSummary = useMemo(() => {
    if (!group || !activeMember || !detailSlot) return null;
    return planDetailSummary(group, activeMember, detailSlot);
  }, [group, activeMember, detailSlot]);

  useEffect(() => {
    if (planDetailSlotId) planDetailRef.current?.showModal();
  }, [planDetailSlotId]);

  useEffect(() => {
    setPlanNoteDraft("");
  }, [planDetailSlotId]);

  if (!group || !session) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-zinc-900">Plans</h1>

      <PlanWallpaperExport group={group} sessionMemberId={session.memberId} />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("person")}
          className={`border-2 px-3 py-1.5 text-xs font-semibold ${
            tab === "person"
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-900 bg-white text-zinc-900"
          }`}
        >
          One person
        </button>
        <button
          type="button"
          onClick={() => setTab("everyone")}
          className={`border-2 px-3 py-1.5 text-xs font-semibold ${
            tab === "everyone"
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-900 bg-white text-zinc-900"
          }`}
        >
          Everyone
        </button>
      </div>

      {tab === "person" ? (
        <div className="space-y-3">
          {activeMember === session.memberId ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-2 border-zinc-900 bg-white px-3 py-2 shadow-[2px_2px_0_0_#18181b]">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-800">
                <input
                  type="checkbox"
                  className="h-4 w-4 border-2 border-zinc-900 accent-zinc-900"
                  checked={planAllowClashes}
                  onChange={(e) => setPlanAllowClashes(e.target.checked)}
                />
                Allow clashes (plan strip)
              </label>
            </div>
          ) : null}
          <label className="flex flex-wrap items-center gap-2 text-sm text-zinc-800">
            <span className="font-medium">Member</span>
            <select
              className="border-2 border-zinc-900 bg-white px-2 py-1 text-sm"
              value={activeMember ?? ""}
              onChange={(e) => setMemberId(e.target.value || null)}
            >
              {group.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                  {m.id === session.memberId ? " (you)" : ""}
                </option>
              ))}
            </select>
          </label>
          {activeMember ? (
            <ScheduleCalendar
              key={memberIntentsKey}
              schedule={group.schedule}
              memberId={activeMember}
              allMemberSlotIntents={group.allMemberSlotIntents}
              group={group}
              slotComments={group.slotComments}
              visibilityMode="effectivePlan"
              showEffectivePlanLayer
              onSetRating={
                activeMember === session.memberId
                  ? (artistId, tier) => setRating(artistId, tier)
                  : undefined
              }
              onSlotOpenDetail={(slot) => setPlanDetailSlotId(slot.id)}
              buildPlanner={
                activeMember === session.memberId
                  ? {
                      memberId: session.memberId,
                      allowClashes: planAllowClashes,
                      stripHydrateKey: planStripHydrateKey,
                      onApplyPlan: async (patches) => {
                        await putSlotIntents(patches);
                        setPlanStripHydrateKey((k) => k + 1);
                      },
                    }
                  : undefined
              }
            />
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {days.length > 1 ? (
            <div className="flex flex-wrap gap-1">
              {days.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDay(d)}
                  className={`border-2 px-2 py-1 text-xs font-medium ${
                    activeDay === d
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-900 bg-white"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          ) : null}

          {!activeDay ? (
            <p className="text-sm text-zinc-600">No schedule for this day.</p>
          ) : (
            <EveryonePlansCalendar
              group={group}
              activeDay={activeDay}
              onSlotOpenDetail={(slot, forMemberId) => {
                setMemberId(forMemberId);
                setTab("person");
                setPlanDetailSlotId(slot.id);
              }}
            />
          )}
        </div>
      )}

      <dialog
        ref={planDetailRef}
        className="max-w-md border-2 border-zinc-900 bg-white p-4 shadow-[4px_4px_0_0_#18181b] backdrop:bg-black/40"
        onClose={() => {
          setPlanDetailSlotId(null);
          setPlanNoteDraft("");
        }}
      >
        {detailSlot && activeMember ? (
          <>
            <h3 className="text-base font-bold text-zinc-900">
              {detailSlot.artistName}
            </h3>
            {openPlanSummary ? (
              <div className="mt-3 space-y-3">
                <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    Festival listing
                  </p>
                  <p className="mt-1 font-mono text-sm font-semibold text-zinc-900">
                    {openPlanSummary.listingTime}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    {openPlanSummary.listingWhere}
                  </p>
                </div>
                <div className="rounded border-2 border-zinc-900 bg-white px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    Your plan
                  </p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">
                    {openPlanSummary.planLine}
                  </p>
                </div>
              </div>
            ) : null}
            {activeMember === session.memberId &&
            effectiveMemberWantsSlot(group, session.memberId, detailSlot.id) ? (
              <button
                type="button"
                disabled={planRemoveBusy}
                className="mt-3 w-full border-2 border-red-800 bg-white py-2 text-xs font-semibold text-red-900 hover:bg-red-50 disabled:opacity-40"
                onClick={() => {
                  setPlanRemoveBusy(true);
                  void (async () => {
                    try {
                      await putSlotIntents([
                        {
                          slotId: detailSlot.id,
                          wants: false,
                          planFrom: null,
                          planTo: null,
                        },
                      ]);
                      setPlanStripHydrateKey((k) => k + 1);
                      planDetailRef.current?.close();
                    } finally {
                      setPlanRemoveBusy(false);
                    }
                  })();
                }}
              >
                {planRemoveBusy ? "…" : "Remove from my plan"}
              </button>
            ) : null}
            <div className="mt-4 border-t border-zinc-200 pt-3">
              <p className="text-xs font-semibold text-zinc-800">Slot notes</p>
              <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs">
                {group.slotComments
                  .filter((c) => c.slotId === detailSlot.id)
                  .map((c) => (
                    <li key={c.id} className="text-zinc-700">
                      <span className="font-medium">
                        {group.members.find((m) => m.id === c.memberId)
                          ?.displayName ?? "?"}
                        :
                      </span>{" "}
                      {c.body}
                    </li>
                  ))}
              </ul>
              <textarea
                className="mt-2 min-h-[56px] w-full border-2 border-zinc-900 px-2 py-1 text-sm"
                placeholder="Note"
                value={planNoteDraft}
                onChange={(e) => setPlanNoteDraft(e.target.value)}
              />
              <button
                type="button"
                disabled={planNoteSaving || !planNoteDraft.trim()}
                className="mt-2 border-2 border-zinc-900 bg-[var(--accent)] px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
                onClick={() => {
                  const t = planNoteDraft.trim();
                  if (!t) return;
                  setPlanNoteSaving(true);
                  void (async () => {
                    try {
                      await addSlotComment(detailSlot.id, t);
                      setPlanNoteDraft("");
                    } finally {
                      setPlanNoteSaving(false);
                    }
                  })();
                }}
              >
                Add note
              </button>
            </div>
            <button
              type="button"
              className="mt-4 text-xs text-zinc-600 underline"
              onClick={() => planDetailRef.current?.close()}
            >
              Close
            </button>
          </>
        ) : null}
      </dialog>
    </div>
  );
}
