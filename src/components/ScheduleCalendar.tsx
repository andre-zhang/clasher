"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { effectiveMemberWantsSlot } from "@/lib/effectiveIntents";
import { hhmmFromMinutes, parseHm } from "@/lib/timeHm";
import {
  compactSquadTierStrip,
  myTierEmoji,
} from "@/lib/reactionsUi";
import type { FestivalSnapshot } from "@/lib/types";

type Slot = FestivalSnapshot["schedule"][0];

function memberWantsSlotRaw(
  all: FestivalSnapshot["allMemberSlotIntents"],
  memberId: string,
  slotId: string
): boolean {
  const row = all.find((i) => i.memberId === memberId && i.slotId === slotId);
  return row ? row.wants : true;
}

function intentWindow(
  all: FestivalSnapshot["allMemberSlotIntents"],
  memberId: string,
  slotId: string
): { from: string | null; to: string | null } {
  const row = all.find((i) => i.memberId === memberId && i.slotId === slotId);
  return {
    from: row?.planFrom ?? null,
    to: row?.planTo ?? null,
  };
}

function slotNotesFor(
  slotComments: FestivalSnapshot["slotComments"],
  slotId: string
) {
  return slotComments.filter((c) => c.slotId === slotId);
}

const NOTE_EMOJIS = ["🔥", "❤️", "🎉", "🚻", "💃", "😴"] as const;

export function ScheduleCalendar({
  schedule,
  memberId,
  allMemberSlotIntents,
  group,
  caption,
  slotComments = [],
  onAddSlotComment,
}: {
  schedule: Slot[];
  memberId?: string;
  allMemberSlotIntents?: FestivalSnapshot["allMemberSlotIntents"];
  /** When set with memberId, applies squad “stay with group” defaults to visibility. */
  group?: FestivalSnapshot | null;
  caption?: string;
  slotComments?: FestivalSnapshot["slotComments"];
  onAddSlotComment?: (slotId: string, body: string) => Promise<void>;
}) {
  const days = useMemo(() => {
    const d = new Set(schedule.map((s) => s.dayLabel.trim()));
    return [...d].sort();
  }, [schedule]);

  const [day, setDay] = useState<string | null>(null);
  const activeDay = day ?? days[0] ?? null;

  const filtered = useMemo(() => {
    let rows = schedule.filter((s) => s.dayLabel.trim() === activeDay);
    if (memberId && group) {
      rows = rows.filter((s) =>
        effectiveMemberWantsSlot(group, memberId, s.id)
      );
    } else if (memberId) {
      const all = allMemberSlotIntents ?? [];
      rows = rows.filter((s) => memberWantsSlotRaw(all, memberId, s.id));
    }
    return rows;
  }, [schedule, activeDay, memberId, allMemberSlotIntents, group]);

  const { stages, minM, maxM } = useMemo(() => {
    if (!filtered.length) {
      return { stages: [] as string[], minM: 0, maxM: 60 };
    }
    const st = [...new Set(filtered.map((s) => s.stageName.trim()))].sort();
    const mins: number[] = [];
    for (const s of filtered) {
      const a = parseHm(s.start);
      const b = parseHm(s.end);
      if (!Number.isNaN(a)) mins.push(a);
      if (!Number.isNaN(b)) mins.push(b);
    }
    const lo = Math.min(...mins);
    const hi = Math.max(...mins);
    const minM = Math.floor(lo / 30) * 30;
    const maxM = Math.max(minM + 60, Math.ceil(hi / 30) * 30);
    return { stages: st, minM, maxM };
  }, [filtered]);

  const ticks = useMemo(() => {
    const t: number[] = [];
    for (let m = minM; m <= maxM; m += 30) t.push(m);
    return t;
  }, [minM, maxM]);

  const pxPerSlot = 28;
  const timelineH = Math.max(ticks.length * pxPerSlot, 120);

  const noteDialogRef = useRef<HTMLDialogElement>(null);
  const [noteSlotId, setNoteSlotId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  const noteSlot = useMemo(
    () => schedule.find((s) => s.id === noteSlotId) ?? null,
    [schedule, noteSlotId]
  );

  useEffect(() => {
    if (noteSlotId) noteDialogRef.current?.showModal();
  }, [noteSlotId]);

  if (!schedule.length) {
    return <p className="text-sm text-zinc-600">No slots.</p>;
  }

  return (
    <div className="space-y-3">
      {caption ? (
        <p className="text-xs font-medium text-zinc-600">{caption}</p>
      ) : null}
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
                  : "border-zinc-900 bg-white text-zinc-900 hover:bg-zinc-100"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      ) : null}

      {!filtered.length ? (
        <p className="text-sm text-zinc-600">Nothing for this day.</p>
      ) : (
        <div className="flex overflow-x-auto border-2 border-zinc-900 bg-white">
          <div
            className="flex shrink-0 flex-col border-r-2 border-zinc-900 bg-zinc-50"
            style={{ width: 52, minHeight: timelineH }}
          >
            <div className="h-8 border-b-2 border-zinc-900" />
            {ticks.map((m) => (
              <div
                key={m}
                className="flex shrink-0 items-start border-b border-zinc-200 px-1 pt-0.5 text-[10px] font-mono text-zinc-600"
                style={{ height: pxPerSlot }}
              >
                {hhmmFromMinutes(m)}
              </div>
            ))}
          </div>
          {stages.map((stage) => (
            <div
              key={stage}
              className="relative min-w-[120px] flex-1 border-r-2 border-zinc-900 last:border-r-0"
              style={{ minHeight: timelineH }}
            >
              <div className="sticky top-0 z-[1] h-8 border-b-2 border-zinc-900 bg-zinc-100 px-1 text-center text-[11px] font-semibold leading-8 text-zinc-900">
                {stage}
              </div>
              <div
                className="relative"
                style={{ height: ticks.length * pxPerSlot }}
              >
                {ticks.map((m, i) => (
                  <div
                    key={m}
                    className="absolute left-0 right-0 border-b border-zinc-100"
                    style={{ top: i * pxPerSlot, height: pxPerSlot }}
                  />
                ))}
                {filtered
                  .filter((s) => s.stageName.trim() === stage)
                  .map((slot) => {
                    const ss = parseHm(slot.start);
                    const ee = parseHm(slot.end);
                    if (Number.isNaN(ss) || Number.isNaN(ee)) return null;
                    const top = ((ss - minM) / (maxM - minM)) * 100;
                    const h = Math.max(((ee - ss) / (maxM - minM)) * 100, 3);
                    const all = group?.allMemberSlotIntents ?? allMemberSlotIntents ?? [];
                    const win = memberId
                      ? intentWindow(all, memberId, slot.id)
                      : { from: null, to: null };
                    const sub =
                      win.from && win.to ? `${win.from}–${win.to}` : null;
                    const reactLine =
                      group && memberId ? (
                        <p
                          className="truncate text-[9px] leading-tight text-zinc-600"
                          title={`You ${myTierEmoji(group, slot.artistId, memberId)} · Squad ${compactSquadTierStrip(group, slot.artistId)}`}
                        >
                          <span className="font-semibold">
                            {myTierEmoji(group, slot.artistId, memberId)}
                          </span>
                          <span className="text-zinc-400"> · </span>
                          <span>
                            {compactSquadTierStrip(
                              group,
                              slot.artistId,
                              memberId
                            )}
                          </span>
                        </p>
                      ) : group ? (
                        <p className="truncate text-[9px] text-zinc-600">
                          {compactSquadTierStrip(group, slot.artistId)}
                        </p>
                      ) : null;
                    const notes = slotNotesFor(slotComments, slot.id);
                    const notePreview = notes[0];
                    return (
                      <div
                        key={slot.id}
                        title={`${slot.artistName} ${slot.start}–${slot.end}`}
                        className="absolute left-0.5 right-0.5 overflow-hidden border-2 border-zinc-900 bg-indigo-50 px-1 py-0.5 text-left shadow-[2px_2px_0_0_#18181b]"
                        style={{
                          top: `${top}%`,
                          height: `${h}%`,
                        }}
                      >
                        <p className="text-[11px] font-semibold leading-tight text-zinc-900">
                          {slot.artistName}
                        </p>
                        {reactLine}
                        <p className="text-[10px] font-mono text-zinc-600">
                          {slot.start}–{slot.end}
                        </p>
                        {sub ? (
                          <p className="text-[10px] text-zinc-700">{sub}</p>
                        ) : null}
                        {notes.length > 0 ? (
                          <p
                            className="mt-0.5 truncate text-[9px] text-zinc-700"
                            title={notes
                              .map((n) => {
                                const who = group?.members.find(
                                  (m) => m.id === n.memberId
                                )?.displayName;
                                return `${who ?? "?"}: ${n.body}`;
                              })
                              .join("\n")}
                          >
                            {notePreview
                              ? `${group?.members.find((m) => m.id === notePreview.memberId)?.displayName?.split(" ")[0] ?? "?"}: ${notePreview.body}`
                              : ""}
                            {notes.length > 1 ? ` +${notes.length - 1}` : ""}
                          </p>
                        ) : null}
                        {onAddSlotComment ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setNoteDraft("");
                              setNoteSlotId(slot.id);
                            }}
                            className="mt-0.5 w-full truncate border border-zinc-400 bg-white/80 px-0.5 text-left text-[9px] font-medium text-zinc-800 hover:bg-white"
                          >
                            {notes.length ? "Notes · add" : "+ Note / emoji"}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}

      <dialog
        ref={noteDialogRef}
        className="max-w-md border-2 border-zinc-900 bg-white p-4 shadow-[4px_4px_0_0_#18181b] backdrop:bg-black/40"
        onClose={() => {
          setNoteSlotId(null);
          setNoteDraft("");
        }}
      >
        {noteSlot ? (
          <>
            <h3 className="text-sm font-bold text-zinc-900">
              {noteSlot.artistName}
            </h3>
            <p className="font-mono text-xs text-zinc-600">
              {noteSlot.dayLabel} · {noteSlot.stageName} · {noteSlot.start}–
              {noteSlot.end}
            </p>
            <ul className="mt-3 max-h-40 space-y-2 overflow-y-auto border-t border-zinc-200 pt-2 text-xs">
              {slotNotesFor(slotComments, noteSlot.id).map((n) => (
                <li key={n.id} className="border border-zinc-200 bg-zinc-50 p-2">
                  <span className="font-semibold text-zinc-700">
                    {group?.members.find((m) => m.id === n.memberId)
                      ?.displayName ?? "?"}
                  </span>
                  <p className="mt-0.5 whitespace-pre-wrap text-zinc-900">
                    {n.body}
                  </p>
                </li>
              ))}
            </ul>
            {onAddSlotComment ? (
              <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3">
                <p className="text-[10px] font-bold uppercase text-zinc-500">
                  Add
                </p>
                <div className="flex flex-wrap gap-1">
                  {NOTE_EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className="border-2 border-zinc-900 bg-white px-1.5 py-0.5 text-sm hover:bg-zinc-100"
                      onClick={() =>
                        setNoteDraft((d) => (d ? `${d} ${e}` : e))
                      }
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <textarea
                  className="min-h-[64px] w-full border-2 border-zinc-900 px-2 py-1 text-sm"
                  placeholder="Note or emoji"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                />
                <button
                  type="button"
                  disabled={noteSaving || !noteDraft.trim()}
                  className="border-2 border-zinc-900 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  onClick={() => {
                    const t = noteDraft.trim();
                    if (!t || !noteSlot) return;
                    setNoteSaving(true);
                    void (async () => {
                      try {
                        await onAddSlotComment(noteSlot.id, t);
                        setNoteDraft("");
                        noteDialogRef.current?.close();
                      } finally {
                        setNoteSaving(false);
                      }
                    })();
                  }}
                >
                  Save note
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className="mt-3 text-xs text-zinc-600 underline"
              onClick={() => noteDialogRef.current?.close()}
            >
              Close
            </button>
          </>
        ) : null}
      </dialog>
    </div>
  );
}
