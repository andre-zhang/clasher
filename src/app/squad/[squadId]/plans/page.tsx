"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { EveryonePlansCalendar } from "@/components/EveryonePlansCalendar";
import { PlanWallpaperExport } from "@/components/PlanWallpaperExport";
import { ScheduleCalendar } from "@/components/ScheduleCalendar";
import { useClasher } from "@/context/ClasherContext";
import {
  describeConflictResolution,
  findMyResolution,
  isMyClashResolved,
} from "@/lib/clash";
import {
  effectiveMemberSlotPlanWindow,
  effectiveMemberWantsSlot,
} from "@/lib/effectiveIntents";
import { planDayTravelLines } from "@/lib/planMemberDay";
import {
  memberEffectivePlanWindowsInfeasibleTogether,
} from "@/lib/walkFeasibility";
import { buildSlotIntentsFromHotRatings } from "@/lib/syncIntentsFromRatings";
import type { FestivalSnapshot } from "@/lib/types";

function planDetailBullets(
  group: FestivalSnapshot,
  memberId: string,
  slot: FestivalSnapshot["schedule"][0]
): string[] {
  const lines: string[] = [
    `Full listing: ${slot.start}–${slot.end} · ${slot.stageName} · ${slot.dayLabel}`,
  ];
  if (effectiveMemberWantsSlot(group, memberId, slot.id)) {
    const w = effectiveMemberSlotPlanWindow(group, memberId, slot);
    if (w.planFrom && w.planTo) {
      lines.push(`Your plan window: ${w.planFrom}–${w.planTo}`);
    } else {
      lines.push("Your plan window: full set (no partial time)");
    }
  } else {
    lines.push("Not on your plan for this window (clash / flags).");
  }

  const travel = planDayTravelLines(group, memberId, slot.dayLabel);
  if (travel.length) {
    lines.push("Travel between your acts this day:");
    lines.push(...travel);
  }

  for (const other of group.schedule) {
    if (other.id === slot.id) continue;
    if (!effectiveMemberWantsSlot(group, memberId, other.id)) continue;
    if (
      !memberEffectivePlanWindowsInfeasibleTogether(
        group,
        memberId,
        slot,
        other
      )
    ) {
      continue;
    }
    const x = slot.id <= other.id ? slot.id : other.id;
    const y = slot.id <= other.id ? other.id : slot.id;
    const a = group.schedule.find((s) => s.id === x)!;
    const b = group.schedule.find((s) => s.id === y)!;
    const r = findMyResolution(group, memberId, x, y);
    if (r && isMyClashResolved(r)) {
      lines.push(
        `Plan overlap / travel with ${other.artistName}: ${describeConflictResolution(r, a, b)}`
      );
    } else if (r) {
      lines.push(
        `Plan overlap / travel with ${other.artistName}: in progress / undecided`
      );
    } else {
      lines.push(
        `Plan overlap or not enough travel with ${other.artistName} (check windows or Options map).`
      );
    }
  }
  return lines;
}

export default function PlansPage() {
  const { session, group, putSlotIntents, addSlotComment, setRating } =
    useClasher();
  const [tab, setTab] = useState<"person" | "everyone">("person");
  const [syncBusy, setSyncBusy] = useState(false);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [planDetailSlotId, setPlanDetailSlotId] = useState<string | null>(
    null
  );
  const [planNoteDraft, setPlanNoteDraft] = useState("");
  const [planNoteSaving, setPlanNoteSaving] = useState(false);
  const planDetailRef = useRef<HTMLDialogElement>(null);

  const me = session?.memberId ?? null;
  const activeMember = memberId ?? me;

  const days = useMemo(() => {
    if (!group) return [];
    const d = new Set(group.schedule.map((s) => s.dayLabel.trim()));
    return [...d].sort();
  }, [group]);

  const activeDay = day ?? days[0] ?? null;

  const detailSlot = useMemo(
    () =>
      group && planDetailSlotId
        ? group.schedule.find((s) => s.id === planDetailSlotId) ?? null
        : null,
    [group, planDetailSlotId]
  );

  useEffect(() => {
    if (planDetailSlotId) planDetailRef.current?.showModal();
  }, [planDetailSlotId]);

  useEffect(() => {
    setPlanNoteDraft("");
  }, [planDetailSlotId]);

  if (!group || !session) return null;

  async function syncHotFlags() {
    if (!group || !session) return;
    setSyncBusy(true);
    try {
      await putSlotIntents(
        buildSlotIntentsFromHotRatings(group, session.memberId)
      );
    } finally {
      setSyncBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-zinc-900">Plans</h1>

      <button
        type="button"
        disabled={syncBusy || !group.schedule.length}
        onClick={() => void syncHotFlags()}
        className="border-2 border-zinc-900 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 shadow-[2px_2px_0_0_#18181b] hover:bg-zinc-100 disabled:opacity-40"
      >
        Sync from Lineup
      </button>

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
            <ul className="mt-3 list-disc space-y-2 pl-4 text-sm text-zinc-800">
              {planDetailBullets(group, activeMember, detailSlot).map(
                (line, i) => (
                  <li key={i}>{line}</li>
                )
              )}
            </ul>
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
