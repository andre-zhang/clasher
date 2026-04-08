"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { PlanWallpaperExport } from "@/components/PlanWallpaperExport";
import { ScheduleCalendar } from "@/components/ScheduleCalendar";
import { useClasher } from "@/context/ClasherContext";
import {
  describeConflictResolution,
  findMyResolution,
  isMyClashResolved,
  slotsTimeOverlap,
} from "@/lib/clash";
import {
  effectiveMemberSlotPlanWindow,
  effectiveMemberWantsSlot,
} from "@/lib/effectiveIntents";
import { hhmmFromMinutes, parseHm } from "@/lib/timeHm";
import { buildSlotIntentsFromHotRatings } from "@/lib/syncIntentsFromRatings";
import type { FestivalSnapshot } from "@/lib/types";

function effectiveWindow(
  group: FestivalSnapshot,
  memberId: string,
  slot: FestivalSnapshot["schedule"][0]
): { start: number; end: number } {
  const s0 = parseHm(slot.start);
  const e0 = parseHm(slot.end);
  if (Number.isNaN(s0) || Number.isNaN(e0)) return { start: 0, end: 0 };
  if (!effectiveMemberWantsSlot(group, memberId, slot.id)) {
    return { start: s0, end: s0 };
  }
  const row = group.allMemberSlotIntents.find(
    (i) => i.memberId === memberId && i.slotId === slot.id
  );
  const eff = effectiveMemberSlotPlanWindow(group, memberId, slot);
  const fromS = eff.planFrom ?? row?.planFrom ?? null;
  const toS = eff.planTo ?? row?.planTo ?? null;
  if (!fromS && !toS && (!row || !row.wants)) {
    return { start: s0, end: e0 };
  }
  const fs = fromS ? parseHm(fromS) : s0;
  const fe = toS ? parseHm(toS) : e0;
  const ss = Number.isNaN(fs) ? s0 : Math.max(s0, fs);
  const ee = Number.isNaN(fe) ? e0 : Math.min(e0, fe);
  return { start: ss, end: Math.max(ss, ee) };
}

function labelAtBucket(
  group: FestivalSnapshot,
  memberId: string,
  day: string,
  bucket: number
): string {
  const bucketEnd = bucket + 30;
  for (const s of group.schedule) {
    if (s.dayLabel.trim() !== day) continue;
    if (!effectiveMemberWantsSlot(group, memberId, s.id)) continue;
    const { start, end } = effectiveWindow(group, memberId, s);
    if (start < bucketEnd && end > bucket) {
      return s.artistName.length > 14
        ? `${s.artistName.slice(0, 12)}…`
        : s.artistName;
    }
  }
  return "—";
}

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

  for (const other of group.schedule) {
    if (other.id === slot.id) continue;
    if (!slotsTimeOverlap(slot, other)) continue;
    const x = slot.id <= other.id ? slot.id : other.id;
    const y = slot.id <= other.id ? other.id : slot.id;
    const a = group.schedule.find((s) => s.id === x)!;
    const b = group.schedule.find((s) => s.id === y)!;
    const r = findMyResolution(group, memberId, x, y);
    if (r && isMyClashResolved(r)) {
      lines.push(
        `Clash with ${other.artistName}: ${describeConflictResolution(r, a, b)}`
      );
    } else if (r) {
      lines.push(
        `Clash with ${other.artistName}: in progress / undecided`
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
  const planDetailRef = useRef<HTMLDialogElement>(null);

  const me = session?.memberId ?? null;
  const activeMember = memberId ?? me;

  const days = useMemo(() => {
    if (!group) return [];
    const d = new Set(group.schedule.map((s) => s.dayLabel.trim()));
    return [...d].sort();
  }, [group]);

  const activeDay = day ?? days[0] ?? null;

  const { buckets, members } = useMemo(() => {
    if (!group || !activeDay) {
      return {
        buckets: [] as number[],
        members: [] as { id: string; displayName: string }[],
      };
    }
    const mins: number[] = [];
    for (const s of group.schedule) {
      if (s.dayLabel.trim() !== activeDay) continue;
      const a = parseHm(s.start);
      const b = parseHm(s.end);
      if (!Number.isNaN(a)) mins.push(a);
      if (!Number.isNaN(b)) mins.push(b);
    }
    if (!mins.length) return { buckets: [], members: group.members };
    const lo = Math.floor(Math.min(...mins) / 30) * 30;
    const hi = Math.ceil(Math.max(...mins) / 30) * 30;
    const b: number[] = [];
    for (let t = lo; t < hi; t += 30) b.push(t);
    return { buckets: b, members: group.members };
  }, [group, activeDay]);

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
              onAddSlotComment={addSlotComment}
              visibilityMode="effectivePlan"
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
        <div className="space-y-3 overflow-x-auto">
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

          {!activeDay || buckets.length === 0 ? (
            <p className="text-sm text-zinc-600">No schedule for this day.</p>
          ) : (
            <div className="flex overflow-x-auto border-2 border-zinc-900 bg-white shadow-[2px_2px_0_0_#18181b]">
              <div
                className="flex shrink-0 flex-col border-r-2 border-zinc-900 bg-zinc-50"
                style={{ width: 52, minHeight: buckets.length * 28 + 32 }}
              >
                <div className="h-8 shrink-0 border-b-2 border-zinc-900" />
                {buckets.map((t) => (
                  <div
                    key={t}
                    className="flex shrink-0 items-start border-b border-zinc-200 px-1 pt-0.5 text-[10px] font-mono text-zinc-600"
                    style={{ height: 28 }}
                  >
                    {hhmmFromMinutes(t)}
                  </div>
                ))}
              </div>
              {members.map((m) => (
                <div
                  key={m.id}
                  className="relative min-w-[104px] flex-1 border-r-2 border-zinc-900 last:border-r-0"
                  style={{ minHeight: buckets.length * 28 + 32 }}
                >
                  <div className="sticky top-0 z-[1] flex h-8 items-center justify-center border-b-2 border-zinc-900 bg-zinc-100 px-1 text-center text-[11px] font-semibold leading-none text-zinc-900">
                    <span className="line-clamp-2">{m.displayName}</span>
                  </div>
                  <div>
                    {buckets.map((t) => {
                      const label = labelAtBucket(group, m.id, activeDay, t);
                      const empty = label === "—";
                      return (
                        <div
                          key={t}
                          className={`flex items-center border-b border-zinc-100 px-1 ${
                            empty ? "bg-white" : "bg-indigo-50"
                          }`}
                          style={{ minHeight: 28 }}
                        >
                          <span
                            className={`text-[10px] leading-tight ${
                              empty
                                ? "text-zinc-400"
                                : "font-semibold text-zinc-900"
                            }`}
                          >
                            {label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <dialog
        ref={planDetailRef}
        className="max-w-md border-2 border-zinc-900 bg-white p-4 shadow-[4px_4px_0_0_#18181b] backdrop:bg-black/40"
        onClose={() => setPlanDetailSlotId(null)}
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
