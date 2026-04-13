"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  EveryonePlansCalendar,
  type EveryonePlansColumn,
} from "@/components/EveryonePlansCalendar";
import { PlanWallpaperExport } from "@/components/PlanWallpaperExport";
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
  const listingTime = `${slot.start}-${slot.end}`;
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
      ? `${w.planFrom}-${w.planTo}`
      : "Full slot (no partial window)";
  return { listingTime, listingWhere, planLine };
}

export default function PlansPage() {
  const { session, group, putSlotIntents, addSlotComment } = useClasher();
  const [day, setDay] = useState<string | null>(null);
  const [planDetailSlotId, setPlanDetailSlotId] = useState<string | null>(
    null
  );
  const [planDetailMemberId, setPlanDetailMemberId] = useState<string | null>(
    null
  );
  const [planNoteDraft, setPlanNoteDraft] = useState("");
  const [planNoteSaving, setPlanNoteSaving] = useState(false);
  const [planRemoveBusy, setPlanRemoveBusy] = useState(false);
  const planDetailRef = useRef<HTMLDialogElement>(null);

  const me = session?.memberId ?? null;

  const days = useMemo(() => {
    if (!group) return [];
    const d = new Set(group.schedule.map((s) => s.dayLabel.trim()));
    return [...d].sort();
  }, [group]);

  const activeDay = day ?? days[0] ?? null;

  const activeDetailMember = planDetailMemberId ?? me;

  const planColumns = useMemo((): EveryonePlansColumn[] => {
    if (!group || !me) return [];
    const others = group.members
      .filter((m) => m.id !== me)
      .sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, {
          sensitivity: "base",
        })
      );
    return [
      {
        key: "mine",
        label: "Mine",
        accent: true,
        mode: "member",
        memberId: me,
      },
      {
        key: "group",
        label: "Group",
        accent: true,
        mode: "groupUnion",
      },
      ...others.map((m) => ({
        key: m.id,
        label: m.displayName,
        mode: "member" as const,
        memberId: m.id,
      })),
    ];
  }, [group, me]);

  const detailSlot = useMemo(
    () =>
      group && planDetailSlotId
        ? group.schedule.find((s) => s.id === planDetailSlotId) ?? null
        : null,
    [group, planDetailSlotId]
  );

  const openPlanSummary = useMemo(() => {
    if (!group || !activeDetailMember || !detailSlot) return null;
    return planDetailSummary(group, activeDetailMember, detailSlot);
  }, [group, activeDetailMember, detailSlot]);

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
          columns={planColumns}
          groupUnionOpenAsMemberId={session.memberId}
          onSlotOpenDetail={(slot, forMemberId) => {
            setPlanDetailMemberId(forMemberId);
            setPlanDetailSlotId(slot.id);
          }}
        />
      )}

      <dialog
        ref={planDetailRef}
        className="max-w-md border-2 border-zinc-900 bg-white p-4 shadow-[4px_4px_0_0_#18181b] backdrop:bg-black/40"
        onClose={() => {
          setPlanDetailSlotId(null);
          setPlanDetailMemberId(null);
          setPlanNoteDraft("");
        }}
      >
        {detailSlot && activeDetailMember ? (
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
                    {activeDetailMember === session.memberId
                      ? "Your plan"
                      : `${
                          group.members.find((m) => m.id === activeDetailMember)
                            ?.displayName ?? "Member"
                        }'s plan`}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">
                    {openPlanSummary.planLine}
                  </p>
                </div>
              </div>
            ) : null}
            {activeDetailMember === session.memberId &&
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
