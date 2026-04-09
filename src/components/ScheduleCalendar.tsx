"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";

import {
  effectiveMemberSlotPlanWindow,
  effectiveMemberWantsSlot,
} from "@/lib/effectiveIntents";
import { hhmmFromMinutes, parseHm } from "@/lib/timeHm";
import { myTierEmoji, squadReactionPills } from "@/lib/reactionsUi";
import { memberKeepsSlotOnScheduleShortlist } from "@/lib/scheduleShortlist";
import { TIER_EMOJI, TIERS_ORDER } from "@/lib/tiers";
import type { FestivalSnapshot, RatingTier } from "@/lib/types";

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

/** Timeline position in px; min height so labels fit; clamp so we do not draw into the next slot on the same stage. */
function slotPixelLayout(
  sorted: Slot[],
  index: number,
  minMR: number,
  maxMR: number,
  timelineBodyPx: number
): { topPx: number; heightPx: number } | null {
  const slot = sorted[index];
  const ss = parseHm(slot.start);
  const ee = parseHm(slot.end);
  if (Number.isNaN(ss) || Number.isNaN(ee)) return null;
  const next = sorted[index + 1];
  const nextStart = next ? parseHm(next.start) : maxMR;
  const range = maxMR - minMR;
  if (range <= 0) return { topPx: 0, heightPx: 72 };
  const topPx = ((ss - minMR) / range) * timelineBodyPx;
  const naturalEndPx = ((ee - minMR) / range) * timelineBodyPx;
  const naturalH = Math.max(0, naturalEndPx - topPx);
  const maxBottomPx = ((nextStart - minMR) / range) * timelineBodyPx;
  const targetH = Math.max(naturalH, 72);
  const rawH = Math.min(targetH, Math.max(0, maxBottomPx - topPx));
  const heightPx = Math.max(rawH, 24);
  return { topPx, heightPx };
}

export function ScheduleCalendar({
  schedule,
  memberId,
  allMemberSlotIntents,
  group,
  caption,
  slotComments = [],
  onAddSlotComment,
  onSetRating,
  /** Schedule “Your plan” uses shortlist (lineup + pins); Plans uses effective (clashes). */
  visibilityMode = "effectivePlan",
  /** Full timetable: viewer for ratings when memberId is not set (e.g. “all stages” view). */
  scheduleViewerMemberId,
  onSlotOpenDetail,
}: {
  schedule: Slot[];
  memberId?: string;
  allMemberSlotIntents?: FestivalSnapshot["allMemberSlotIntents"];
  group?: FestivalSnapshot | null;
  caption?: string;
  slotComments?: FestivalSnapshot["slotComments"];
  onAddSlotComment?: (slotId: string, body: string) => Promise<void>;
  onSetRating?: (artistId: string, tier: RatingTier) => Promise<void>;
  visibilityMode?: "effectivePlan" | "scheduleShortlist";
  scheduleViewerMemberId?: string;
  onSlotOpenDetail?: (slot: Slot) => void;
}) {
  const rateMemberId = memberId ?? scheduleViewerMemberId;

  const days = useMemo(() => {
    const d = new Set(schedule.map((s) => s.dayLabel.trim()));
    return [...d].sort();
  }, [schedule]);

  const [day, setDay] = useState<string | null>(null);
  const activeDay = day ?? days[0] ?? null;

  const filtered = useMemo(() => {
    let rows = schedule.filter((s) => s.dayLabel.trim() === activeDay);
    if (memberId && group && visibilityMode === "scheduleShortlist") {
      rows = rows.filter((s) =>
        memberKeepsSlotOnScheduleShortlist(group, memberId, s.id)
      );
    } else if (memberId && group && visibilityMode === "effectivePlan") {
      rows = rows.filter((s) =>
        effectiveMemberWantsSlot(group, memberId, s.id)
      );
    } else if (memberId) {
      const all = allMemberSlotIntents ?? [];
      rows = rows.filter((s) => memberWantsSlotRaw(all, memberId, s.id));
    }
    return rows;
  }, [
    schedule,
    activeDay,
    memberId,
    allMemberSlotIntents,
    group,
    visibilityMode,
  ]);

  const pxPerSlot = 28;

  const noteDialogRef = useRef<HTMLDialogElement>(null);
  const [noteSlotId, setNoteSlotId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [ratingBusy, setRatingBusy] = useState<string | null>(null);

  const noteSlot = useMemo(
    () => schedule.find((s) => s.id === noteSlotId) ?? null,
    [schedule, noteSlotId]
  );

  useEffect(() => {
    if (noteSlotId) noteDialogRef.current?.showModal();
  }, [noteSlotId]);

  const allStagesForDay = useMemo(() => {
    const rows = schedule.filter((s) => s.dayLabel.trim() === activeDay);
    return [...new Set(rows.map((s) => s.stageName.trim()))].sort();
  }, [schedule, activeDay]);

  const showAllStages = Boolean(
    scheduleViewerMemberId && !memberId && group && visibilityMode === "effectivePlan"
  );

  const stagesFromFiltered = useMemo(() => {
    if (!filtered.length) return [] as string[];
    return [...new Set(filtered.map((s) => s.stageName.trim()))].sort();
  }, [filtered]);

  const stagesToRender = showAllStages ? allStagesForDay : stagesFromFiltered;
  const slotsForStage = (stage: string) => {
    const base = schedule.filter(
      (s) =>
        s.dayLabel.trim() === activeDay && s.stageName.trim() === stage
    );
    if (!showAllStages) {
      return base.filter((s) => filtered.some((f) => f.id === s.id));
    }
    return base;
  };

  const minMaxForStages = useMemo(() => {
    const rows = showAllStages
      ? schedule.filter((s) => s.dayLabel.trim() === activeDay)
      : filtered;
    if (!rows.length) {
      return { minM: 0, maxM: 60 };
    }
    const mins: number[] = [];
    for (const s of rows) {
      const a = parseHm(s.start);
      const b = parseHm(s.end);
      if (!Number.isNaN(a)) mins.push(a);
      if (!Number.isNaN(b)) mins.push(b);
    }
    const lo = Math.min(...mins);
    const hi = Math.max(...mins);
    const minM = Math.floor(lo / 30) * 30;
    const maxM = Math.max(minM + 60, Math.ceil(hi / 30) * 30);
    return { minM, maxM };
  }, [showAllStages, schedule, activeDay, filtered]);

  const ticksRender = useMemo(() => {
    const t: number[] = [];
    const { minM: lo, maxM: hi } = minMaxForStages;
    for (let m = lo; m <= hi; m += 30) t.push(m);
    return t;
  }, [minMaxForStages]);

  const timelineHRender = Math.max(ticksRender.length * pxPerSlot, 120);
  const timelineBodyPx = ticksRender.length * pxPerSlot;
  const { minM: minMR, maxM: maxMR } = minMaxForStages;

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

      {!showAllStages && !filtered.length ? (
        <p className="text-sm text-zinc-600">Nothing for this day.</p>
      ) : showAllStages && !allStagesForDay.length ? (
        <p className="text-sm text-zinc-600">Nothing for this day.</p>
      ) : (
        <div className="flex overflow-x-auto border-2 border-zinc-900 bg-white">
          <div
            className="flex shrink-0 flex-col border-r-2 border-zinc-900 bg-zinc-50"
            style={{ width: 52, minHeight: timelineHRender }}
          >
            <div className="h-8 border-b-2 border-zinc-900" />
            {ticksRender.map((m) => (
              <div
                key={m}
                className="flex shrink-0 items-start border-b border-zinc-200 px-1 pt-0.5 text-[10px] font-mono text-zinc-600"
                style={{ height: pxPerSlot }}
              >
                {hhmmFromMinutes(m)}
              </div>
            ))}
          </div>
          {stagesToRender.map((stage) => {
            const sortedSlots = [...slotsForStage(stage)].sort(
              (a, b) => parseHm(a.start) - parseHm(b.start)
            );
            return (
            <div
              key={stage}
              className="relative min-w-[148px] flex-1 border-r-2 border-zinc-900 last:border-r-0"
              style={{ minHeight: timelineHRender }}
            >
              <div className="sticky top-0 z-[1] h-8 border-b-2 border-zinc-900 bg-zinc-100 px-1 text-center text-[11px] font-semibold leading-8 text-zinc-900">
                {stage}
              </div>
              <div
                className="relative"
                style={{ height: ticksRender.length * pxPerSlot }}
              >
                {ticksRender.map((m, i) => (
                  <div
                    key={m}
                    className="absolute left-0 right-0 border-b border-zinc-100"
                    style={{ top: i * pxPerSlot, height: pxPerSlot }}
                  />
                ))}
                {sortedSlots.map((slot, slotIndex) => {
                  const layout = slotPixelLayout(
                    sortedSlots,
                    slotIndex,
                    minMR,
                    maxMR,
                    timelineBodyPx
                  );
                  if (!layout) return null;
                  const { topPx, heightPx } = layout;
                  const all =
                    group?.allMemberSlotIntents ?? allMemberSlotIntents ?? [];
                  const planMember = rateMemberId;
                  const win =
                    group && planMember
                      ? effectiveMemberSlotPlanWindow(
                          group,
                          planMember,
                          slot
                        )
                      : planMember
                        ? (() => {
                            const w = intentWindow(all, planMember, slot.id);
                            return {
                              planFrom: w.from,
                              planTo: w.to,
                            };
                          })()
                        : { planFrom: null, planTo: null };
                  const sub =
                    win.planFrom && win.planTo
                      ? `${win.planFrom}–${win.planTo}`
                      : null;
                  const notes = slotNotesFor(slotComments, slot.id);
                  const notePreview = notes[0];
                  const showQuickRate = Boolean(
                    rateMemberId && group && onSetRating
                  );
                  const myEmoji =
                    group && rateMemberId
                      ? myTierEmoji(group, slot.artistId, rateMemberId)
                      : "·";
                  const squadPills = group
                    ? squadReactionPills(group, slot.artistId)
                    : [];

                  const canOpenPanel = Boolean(
                    onAddSlotComment || showQuickRate
                  );
                  const openDetailOrPanel = Boolean(
                    onSlotOpenDetail || canOpenPanel
                  );

                  const stopBubble = (e: SyntheticEvent) => {
                    e.stopPropagation();
                  };

                  const handleCardActivate = () => {
                    if (onSlotOpenDetail) {
                      onSlotOpenDetail(slot);
                      return;
                    }
                    if (canOpenPanel) {
                      setNoteDraft("");
                      setNoteSlotId(slot.id);
                    }
                  };

                  const shellClass = `absolute left-0.5 right-0.5 border-2 border-zinc-900 bg-indigo-50 px-1 py-0.5 text-left shadow-[2px_2px_0_0_#18181b] flex min-h-0 flex-col overflow-hidden ${
                    openDetailOrPanel
                      ? "cursor-pointer hover:bg-indigo-100"
                      : ""
                  }`;

                  return (
                    <div
                      key={slot.id}
                      title={`${slot.artistName} ${slot.start}–${slot.end}`}
                      role={openDetailOrPanel ? "button" : undefined}
                      tabIndex={openDetailOrPanel ? 0 : undefined}
                      onClick={openDetailOrPanel ? handleCardActivate : undefined}
                      onKeyDown={
                        openDetailOrPanel
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleCardActivate();
                              }
                            }
                          : undefined
                      }
                      className={shellClass}
                      style={{
                        top: topPx,
                        height: heightPx,
                        zIndex: 5 + slotIndex,
                      }}
                    >
                      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                        <p className="shrink-0 break-words text-[11px] font-semibold leading-snug text-zinc-900 [overflow-wrap:anywhere]">
                          {slot.artistName}
                        </p>

                        {showQuickRate || squadPills.length > 0 ? (
                          <div
                            className="flex flex-wrap items-center gap-1"
                            onClick={stopBubble}
                            onKeyDown={stopBubble}
                          >
                            {showQuickRate ? (
                              <span
                                className="inline-flex flex-wrap gap-0.5"
                                title="Your rating"
                              >
                                {TIERS_ORDER.map((tier) => {
                                  const active =
                                    myEmoji === TIER_EMOJI[tier];
                                  return (
                                    <button
                                      key={tier}
                                      type="button"
                                      disabled={ratingBusy === slot.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!onSetRating) return;
                                        setRatingBusy(slot.id);
                                        void (async () => {
                                          try {
                                            await onSetRating(
                                              slot.artistId,
                                              tier
                                            );
                                          } finally {
                                            setRatingBusy(null);
                                          }
                                        })();
                                      }}
                                      className={`min-h-[18px] min-w-[18px] rounded border px-0.5 text-[11px] leading-none transition-colors ${
                                        active
                                          ? "border-zinc-900 bg-zinc-900 text-white"
                                          : "border-zinc-300 bg-white text-zinc-800 hover:border-zinc-900"
                                      } disabled:opacity-40`}
                                    >
                                      {TIER_EMOJI[tier]}
                                    </button>
                                  );
                                })}
                              </span>
                            ) : null}
                            {squadPills.length > 0 ? (
                              <span className="inline-flex flex-wrap gap-0.5">
                                {squadPills.map(({ tier, emoji, count }) => (
                                  <span
                                    key={tier}
                                    className="rounded-full border border-zinc-300 bg-white/90 px-1 py-px text-[9px] font-medium tabular-nums text-zinc-700"
                                  >
                                    {emoji}
                                    {count}
                                  </span>
                                ))}
                              </span>
                            ) : null}
                          </div>
                        ) : null}

                        <p className="shrink-0 font-mono text-[10px] text-zinc-600">
                          {slot.start}–{slot.end}
                        </p>
                        {sub ? (
                          <p className="shrink-0 text-[10px] text-zinc-700">
                            {sub}
                          </p>
                        ) : null}

                        {notes.length > 0 ? (
                          <p
                            className="mt-0.5 shrink-0 truncate text-[9px] text-zinc-700"
                            title={notes
                              .map((n) => {
                                const who = group?.members.find(
                                  (m) => m.id === n.memberId
                                )?.displayName;
                                return `${who ?? "?"}: ${n.body}`;
                              })
                              .join("\n")}
                            onClick={stopBubble}
                          >
                            {notePreview
                              ? `${group?.members.find((m) => m.id === notePreview.memberId)?.displayName?.split(" ")[0] ?? "?"}: ${notePreview.body}`
                              : ""}
                            {notes.length > 1
                              ? ` +${notes.length - 1}`
                              : ""}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })}
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
            {onSetRating && rateMemberId && group ? (
              <div
                className="mt-3 border-t border-zinc-200 pt-3"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <div className="flex flex-wrap gap-1">
                  {TIERS_ORDER.map((tier) => {
                    const active =
                      myTierEmoji(group, noteSlot.artistId, rateMemberId) ===
                      TIER_EMOJI[tier];
                    return (
                      <button
                        key={tier}
                        type="button"
                        disabled={ratingBusy === noteSlot.id}
                        onClick={() => {
                          if (!onSetRating) return;
                          setRatingBusy(noteSlot.id);
                          void (async () => {
                            try {
                              await onSetRating(noteSlot.artistId, tier);
                            } finally {
                              setRatingBusy(null);
                            }
                          })();
                        }}
                        className={`min-h-[28px] min-w-[28px] rounded border px-1 text-sm leading-none transition-colors ${
                          active
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-300 bg-white text-zinc-800 hover:border-zinc-900"
                        } disabled:opacity-40`}
                      >
                        {TIER_EMOJI[tier]}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <ul className="mt-3 max-h-40 space-y-2 overflow-y-auto border-t border-zinc-200 pt-3 text-xs">
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
                <textarea
                  className="min-h-[64px] w-full border-2 border-zinc-900 px-2 py-1 text-sm"
                  placeholder="Note"
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
