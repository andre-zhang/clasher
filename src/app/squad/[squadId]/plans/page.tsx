"use client";

import { useMemo, useState } from "react";

import { ScheduleCalendar } from "@/components/ScheduleCalendar";
import { useClasher } from "@/context/ClasherContext";
import { effectiveMemberWantsSlot } from "@/lib/effectiveIntents";
import { hhmmFromMinutes, parseHm } from "@/lib/timeHm";
import { buildSlotIntentsFromHotRatings } from "@/lib/syncIntentsFromRatings";
import type { FestivalSnapshot } from "@/lib/types";

function effectiveWindow(
  group: FestivalSnapshot,
  memberId: string,
  slot: FestivalSnapshot["schedule"][0]
): { start: number; end: number } {
  const row = group.allMemberSlotIntents.find(
    (i) => i.memberId === memberId && i.slotId === slot.id
  );
  const s0 = parseHm(slot.start);
  const e0 = parseHm(slot.end);
  if (Number.isNaN(s0) || Number.isNaN(e0)) return { start: 0, end: 0 };
  if (!effectiveMemberWantsSlot(group, memberId, slot.id)) {
    return { start: s0, end: s0 };
  }
  // No personal row or wants=false but squad default still shows this slot → full slot window.
  if (!row || !row.wants) return { start: s0, end: e0 };
  const fs = row.planFrom ? parseHm(row.planFrom) : s0;
  const fe = row.planTo ? parseHm(row.planTo) : e0;
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

export default function PlansPage() {
  const { session, group, putSlotIntents } = useClasher();
  const [tab, setTab] = useState<"person" | "everyone">("person");
  const [syncBusy, setSyncBusy] = useState(false);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);

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
      return { buckets: [] as number[], members: [] as { id: string; displayName: string }[] };
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
        Sync ❤️/🔥 → slot flags
      </button>

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
          One person · stage × time
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
          Everyone · people × time
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
            <table className="min-w-full border-collapse border-2 border-zinc-900 text-left text-xs">
              <thead>
                <tr>
                  <th className="border-2 border-zinc-900 bg-zinc-100 px-2 py-1 font-mono">
                    Time
                  </th>
                  {members.map((m) => (
                    <th
                      key={m.id}
                      className="border-2 border-zinc-900 bg-zinc-100 px-2 py-1"
                    >
                      {m.displayName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {buckets.map((t) => (
                  <tr key={t}>
                    <td className="border border-zinc-300 bg-zinc-50 px-2 py-1 font-mono text-zinc-700">
                      {hhmmFromMinutes(t)}
                    </td>
                    {members.map((m) => (
                      <td
                        key={m.id}
                        className="border border-zinc-300 px-2 py-1 text-zinc-900"
                      >
                        {labelAtBucket(group, m.id, activeDay, t)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
