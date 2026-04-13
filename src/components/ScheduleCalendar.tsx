"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from "react";

import { SchedulePlannerStrip } from "@/components/SchedulePlannerStrip";
import { findMyResolution, isMyClashResolved } from "@/lib/clash";
import {
  effectiveMemberSlotPlanWindow,
  effectiveMemberWantsSlot,
} from "@/lib/effectiveIntents";
import { effectiveWindowMinutes } from "@/lib/planMemberDay";
import { walkBandsBetweenOrderedActs } from "@/lib/planWalkBands";
import { recomputeStripWindowsSequential } from "@/lib/planStripWalk";
import { hhmmFromMinutes, parseHm } from "@/lib/timeHm";
import {
  clampPlanWindowToSlot,
  memberEffectivePlanWindowsInfeasibleTogether,
} from "@/lib/walkFeasibility";
import { myTierEmoji, squadReactionPills } from "@/lib/reactionsUi";
import { memberKeepsSlotOnScheduleShortlist } from "@/lib/scheduleShortlist";
import { TIER_EMOJI, TIERS_ORDER } from "@/lib/tiers";
import type { FestivalSnapshot, RatingTier } from "@/lib/types";

function snapMinutesTo5(m: number): number {
  return Math.round(m / 5) * 5;
}

type Slot = FestivalSnapshot["schedule"][0];

function memberWantsSlotRaw(
  all: FestivalSnapshot["allMemberSlotIntents"],
  memberId: string,
  slotId: string
): boolean {
  const row = all.find((i) => i.memberId === memberId && i.slotId === slotId);
  return row ? row.wants : true;
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
  if (range <= 0) return { topPx: 0, heightPx: 40 };
  const topPx = ((ss - minMR) / range) * timelineBodyPx;
  const naturalEndPx = ((ee - minMR) / range) * timelineBodyPx;
  const naturalH = Math.max(0, naturalEndPx - topPx);
  const maxBottomPx = ((nextStart - minMR) / range) * timelineBodyPx;
  const targetH = Math.max(naturalH, 40);
  const rawH = Math.min(targetH, Math.max(0, maxBottomPx - topPx));
  const heightPx = Math.max(rawH, 20);
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
  showEffectivePlanLayer = false,
  /** Full timetable: viewer for ratings when memberId is not set (e.g. “all stages” view). */
  scheduleViewerMemberId,
  onSlotOpenDetail,
  buildPlanner,
  /** One combined time column (like Everyone plan view), not split by stage. */
  singleColumnTimeline = false,
  /** Hide tier emoji row on slot cards (e.g. Plans). */
  hideSlotReactions = false,
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
  showEffectivePlanLayer?: boolean;
  scheduleViewerMemberId?: string;
  onSlotOpenDetail?: (slot: Slot) => void;
  singleColumnTimeline?: boolean;
  hideSlotReactions?: boolean;
  buildPlanner?: {
    memberId: string;
    /** Bump after a successful strip apply so the strip reloads from server intents. */
    stripHydrateKey?: number;
    onApplyPlan: (
      patches: {
        slotId: string;
        wants: boolean;
        planFrom: string | null;
        planTo: string | null;
      }[]
    ) => Promise<void>;
  };
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
  const [stripIds, setStripIds] = useState<string[]>([]);
  const [stripWindows, setStripWindows] = useState<
    Record<string, { planFrom: string; planTo: string }>
  >({});
  const [stripResize, setStripResize] = useState<{
    slotId: string;
    edge: "start" | "end";
    anchorClientY: number;
    baseFromM: number;
    baseToM: number;
    pointerId: number;
  } | null>(null);
  const [stripScope, setStripScope] = useState<"mine" | "group">("mine");
  /** Pin plan strip beside the time rail while scrolling (like sticky time column). */
  const [stripPinned, setStripPinned] = useState(false);
  /** “Everyone” strip: slots you added from the grid before first save (not from others’ plans). */
  const [stripUserAddedIds, setStripUserAddedIds] = useState<Set<string>>(
    () => new Set()
  );

  const groupRef = useRef(group);
  groupRef.current = group;
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;
  const stripResizeRef = useRef(false);
  stripResizeRef.current = Boolean(stripResize);

  const timelineMetricsRef = useRef({
    minMR: 0,
    maxMR: 60,
    timelineBodyPx: 100,
  });

  const noteSlot = useMemo(
    () => schedule.find((s) => s.id === noteSlotId) ?? null,
    [schedule, noteSlotId]
  );

  useEffect(() => {
    if (noteSlotId) noteDialogRef.current?.showModal();
  }, [noteSlotId]);

  useEffect(() => {
    if (!buildPlanner) {
      setStripIds([]);
      setStripWindows({});
    }
  }, [buildPlanner]);

  const stripHydrateKey = buildPlanner?.stripHydrateKey ?? 0;
  const plannerMemberId = buildPlanner?.memberId;

  const allIntentsHydrateSig = useMemo(() => {
    if (!group) return "";
    return group.allMemberSlotIntents
      .map(
        (i) =>
          `${i.memberId}:${i.slotId}:${i.wants ? 1 : 0}:${i.planFrom ?? ""}:${i.planTo ?? ""}`
      )
      .sort()
      .join("|");
  }, [group]);

  useEffect(() => {
    setStripUserAddedIds(new Set());
  }, [activeDay, stripScope]);

  useEffect(() => {
    if (!plannerMemberId || !groupRef.current) return;
    const g = groupRef.current;
    setStripUserAddedIds((prev) => {
      if (!prev.size) return prev;
      const next = new Set(prev);
      for (const id of prev) {
        if (effectiveMemberWantsSlot(g, plannerMemberId, id)) {
          next.delete(id);
        }
      }
      return next.size === prev.size ? prev : next;
    });
  }, [allIntentsHydrateSig, plannerMemberId]);

  useEffect(() => {
    if (!stripIds.length) {
      setStripUserAddedIds(new Set());
    }
  }, [stripIds.length]);

  useEffect(() => {
    setStripResize(null);
  }, [activeDay, stripScope]);

  useEffect(() => {
    if (!plannerMemberId || !activeDay) return;
    if (stripResizeRef.current) return;
    const g = groupRef.current;
    if (!g) return;
    const sched = scheduleRef.current;
    const dayKey = activeDay.trim();
    const daySlots = sched.filter((s) => s.dayLabel.trim() === dayKey);
    if (stripScope === "mine") {
      const wanted = daySlots.filter((s) =>
        effectiveMemberWantsSlot(g, plannerMemberId, s.id)
      );
      wanted.sort((a, b) => {
        const wa = effectiveMemberSlotPlanWindow(g, plannerMemberId, a);
        const wb = effectiveMemberSlotPlanWindow(g, plannerMemberId, b);
        const ta = parseHm(wa.planFrom ?? a.start);
        const tb = parseHm(wb.planFrom ?? b.start);
        const fa = Number.isNaN(ta) ? parseHm(a.start) : ta;
        const fb = Number.isNaN(tb) ? parseHm(b.start) : tb;
        return fa - fb;
      });
      const ids = wanted.map((s) => s.id);
      const wins: Record<string, { planFrom: string; planTo: string }> = {};
      for (const s of wanted) {
        const w = effectiveMemberSlotPlanWindow(g, plannerMemberId, s);
        wins[s.id] = {
          planFrom: w.planFrom ?? s.start,
          planTo: w.planTo ?? s.end,
        };
      }
      setStripIds(ids);
      setStripWindows(wins);
      return;
    }
    const idSet = new Set<string>();
    for (const m of g.members) {
      for (const s of daySlots) {
        const row = g.allMemberSlotIntents.find(
          (i) => i.memberId === m.id && i.slotId === s.id
        );
        if (row?.wants) idSet.add(s.id);
      }
    }
    const ids = daySlots
      .filter((s) => idSet.has(s.id))
      .sort((a, b) => parseHm(a.start) - parseHm(b.start))
      .map((s) => s.id);
    setStripIds(ids);
    setStripWindows(recomputeStripWindowsSequential(g, ids, sched));
  }, [
    stripHydrateKey,
    activeDay,
    stripScope,
    plannerMemberId,
    allIntentsHydrateSig,
  ]);

  const allStagesForDay = useMemo(() => {
    const rows = schedule.filter((s) => s.dayLabel.trim() === activeDay);
    return [...new Set(rows.map((s) => s.stageName.trim()))].sort();
  }, [schedule, activeDay]);

  const showAllStages = Boolean(
    scheduleViewerMemberId && !memberId && group && visibilityMode === "effectivePlan"
  );

  const singleCol = Boolean(
    singleColumnTimeline &&
      memberId &&
      group &&
      visibilityMode === "effectivePlan"
  );

  const stagesFromFiltered = useMemo(() => {
    if (!filtered.length) return [] as string[];
    return [...new Set(filtered.map((s) => s.stageName.trim()))].sort();
  }, [filtered]);

  const stagesToRender = singleCol
    ? ["_plan_"]
    : showAllStages
      ? allStagesForDay
      : stagesFromFiltered;

  const slotsForStage = (stage: string) => {
    if (singleCol) {
      return [...filtered].sort(
        (a, b) => layoutSortStart(a) - layoutSortStart(b)
      );
    }
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
    const rows = singleCol
      ? filtered
      : showAllStages
        ? schedule.filter((s) => s.dayLabel.trim() === activeDay)
        : filtered;
    const dayKey = activeDay?.trim() ?? "";
    const byId = new Map<string, Slot>();
    for (const s of rows) {
      byId.set(s.id, s);
    }
    /** Strip can include slots not on the filtered grid (e.g. group scope); include them so Y↔time mapping matches the plan strip and resize stays within real set times. */
    if (buildPlanner && dayKey) {
      for (const id of stripIds) {
        const s = schedule.find((x) => x.id === id);
        if (s && s.dayLabel.trim() === dayKey) byId.set(s.id, s);
      }
    }
    const unionRows = [...byId.values()];
    if (!unionRows.length) {
      return { minM: 0, maxM: 60 };
    }
    const mins: number[] = [];
    for (const s of unionRows) {
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
  }, [
    singleCol,
    showAllStages,
    schedule,
    activeDay,
    filtered,
    buildPlanner,
    stripIds,
  ]);

  const ticksRender = useMemo(() => {
    const t: number[] = [];
    const { minM: lo, maxM: hi } = minMaxForStages;
    for (let m = lo; m <= hi; m += 30) t.push(m);
    return t;
  }, [minMaxForStages]);

  const timelineHRender = Math.max(ticksRender.length * pxPerSlot, 120);
  const timelineBodyPx = ticksRender.length * pxPerSlot;
  const { minM: minMR, maxM: maxMR } = minMaxForStages;

  timelineMetricsRef.current = { minMR, maxMR, timelineBodyPx };

  const useEffectiveSlotLayout = Boolean(
    group &&
      rateMemberId &&
      visibilityMode === "effectivePlan" &&
      showEffectivePlanLayer
  );

  const planWalkBands = useMemo(() => {
    if (!group?.walkTimesEnabled || !activeDay) return [];
    const dayKey = activeDay.trim();
    if (buildPlanner && stripIds.length > 0) {
      const ordered = stripIds
        .map((id) => schedule.find((s) => s.id === id))
        .filter((s): s is Slot => Boolean(s));
      return walkBandsBetweenOrderedActs(group, ordered, stripWindows);
    }
    if (rateMemberId && useEffectiveSlotLayout) {
      const slots = schedule.filter(
        (s) =>
          s.dayLabel.trim() === dayKey &&
          effectiveMemberWantsSlot(group, rateMemberId, s.id)
      );
      slots.sort(
        (a, b) =>
          effectiveWindowMinutes(group, rateMemberId, a).start -
          effectiveWindowMinutes(group, rateMemberId, b).start
      );
      const wins: Record<string, { planFrom: string; planTo: string }> = {};
      for (const s of slots) {
        const eff = effectiveMemberSlotPlanWindow(group, rateMemberId, s);
        wins[s.id] = {
          planFrom: eff.planFrom ?? s.start,
          planTo: eff.planTo ?? s.end,
        };
      }
      return walkBandsBetweenOrderedActs(group, slots, wins);
    }
    return [];
  }, [
    group,
    activeDay,
    buildPlanner,
    stripIds,
    stripWindows,
    schedule,
    rateMemberId,
    useEffectiveSlotLayout,
  ]);

  const { clashOverlapIntervalsBySlot, clashWalkOnlySlotIds } = useMemo(() => {
    const m = new Map<string, { o0: number; o1: number }[]>();
    const walkOnly = new Set<string>();
    if (!group || !rateMemberId || !activeDay || !useEffectiveSlotLayout) {
      return { clashOverlapIntervalsBySlot: m, clashWalkOnlySlotIds: walkOnly };
    }
    const dayKey = activeDay.trim();
    const wanted = schedule.filter(
      (s) =>
        s.dayLabel.trim() === dayKey &&
        effectiveMemberWantsSlot(group, rateMemberId, s.id)
    );
    for (let i = 0; i < wanted.length; i++) {
      for (let j = i + 1; j < wanted.length; j++) {
        const a = wanted[i]!;
        const b = wanted[j]!;
        const x = a.id <= b.id ? a.id : b.id;
        const y = a.id <= b.id ? b.id : a.id;
        const r = findMyResolution(group, rateMemberId, x, y);
        if (isMyClashResolved(r)) continue;
        if (
          !memberEffectivePlanWindowsInfeasibleTogether(
            group,
            rateMemberId,
            a,
            b
          )
        ) {
          continue;
        }
        const wa = effectiveWindowMinutes(group, rateMemberId, a);
        const wb = effectiveWindowMinutes(group, rateMemberId, b);
        const o0 = Math.max(wa.start, wb.start);
        const o1 = Math.min(wa.end, wb.end);
        if (o0 >= o1) {
          walkOnly.add(a.id);
          walkOnly.add(b.id);
          continue;
        }
        const pushSeg = (id: string, ws: number, we: number) => {
          if (o1 <= ws || o0 >= we) return;
          const seg0 = Math.max(o0, ws);
          const seg1 = Math.min(o1, we);
          const arr = m.get(id) ?? [];
          arr.push({ o0: seg0, o1: seg1 });
          m.set(id, arr);
        };
        pushSeg(a.id, wa.start, wa.end);
        pushSeg(b.id, wb.start, wb.end);
      }
    }
    return { clashOverlapIntervalsBySlot: m, clashWalkOnlySlotIds: walkOnly };
  }, [group, rateMemberId, activeDay, schedule, useEffectiveSlotLayout]);

  useEffect(() => {
    if (!stripResize || !buildPlanner) return;
    const slot = schedule.find((s) => s.id === stripResize.slotId);
    if (!slot) {
      setStripResize(null);
      return;
    }
    const slotLo = parseHm(slot.start);
    const slotHi = parseHm(slot.end);
    const slotId = stripResize.slotId;
    const edge = stripResize.edge;
    const pointerId = stripResize.pointerId;
    const baseFromM = stripResize.baseFromM;
    const baseToM = stripResize.baseToM;
    const anchorClientY = stripResize.anchorClientY;

    const slotSpanMin =
      !Number.isNaN(slotLo) &&
      !Number.isNaN(slotHi) &&
      slotHi > slotLo
        ? slotHi - slotLo
        : 60;
    const minBlockMin = Math.max(1, Math.min(5, slotSpanMin));

    const onMove = (ev: Event) => {
      const e = ev as PointerEvent;
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      const { minMR: loR, maxMR: hiR, timelineBodyPx: tb } =
        timelineMetricsRef.current;
      const range = hiR - loR;
      if (range <= 0 || tb <= 0) return;
      const deltaY = e.clientY - anchorClientY;
      const deltaMin = (deltaY / tb) * range;
      let sm: number;
      let em: number;
      if (edge === "end") {
        sm = baseFromM;
        em = baseToM + deltaMin;
      } else {
        sm = baseFromM + deltaMin;
        em = baseToM;
      }
      if (!Number.isNaN(slotLo) && !Number.isNaN(slotHi)) {
        sm = Math.max(slotLo, Math.min(slotHi, sm));
        em = Math.max(slotLo, Math.min(slotHi, em));
        if (edge === "end") {
          em = Math.max(em, sm + minBlockMin);
          em = Math.min(em, slotHi);
        } else {
          sm = Math.min(sm, em - minBlockMin);
          sm = Math.max(sm, slotLo);
        }
      }
      if (em < sm) {
        if (edge === "end") em = sm + minBlockMin;
        else sm = em - minBlockMin;
      }
      setStripWindows((prev) => ({
        ...prev,
        [slotId]: {
          planFrom: hhmmFromMinutes(sm),
          planTo: hhmmFromMinutes(em),
        },
      }));
    };
    const onUp = (ev: Event) => {
      const e = ev as PointerEvent;
      if (e.pointerId !== pointerId) return;
      setStripWindows((prev) => {
        const cur = prev[slotId];
        if (!cur) return prev;
        const c = clampPlanWindowToSlot(slot, cur.planFrom, cur.planTo);
        let sm = parseHm(c.planFrom);
        let em = parseHm(c.planTo);
        if (Number.isNaN(sm) || Number.isNaN(em)) return prev;
        sm = snapMinutesTo5(Math.round(sm));
        em = snapMinutesTo5(Math.round(em));
        const fin = clampPlanWindowToSlot(
          slot,
          hhmmFromMinutes(sm),
          hhmmFromMinutes(em)
        );
        return { ...prev, [slotId]: { planFrom: fin.planFrom, planTo: fin.planTo } };
      });
      setStripResize(null);
    };
    document.addEventListener("pointermove", onMove, {
      capture: true,
      passive: false,
    });
    document.addEventListener("pointerup", onUp, { capture: true });
    document.addEventListener("pointercancel", onUp, { capture: true });
    return () => {
      document.removeEventListener("pointermove", onMove, { capture: true });
      document.removeEventListener("pointerup", onUp, { capture: true });
      document.removeEventListener("pointercancel", onUp, { capture: true });
    };
  }, [stripResize, schedule, buildPlanner]);

  function layoutSortStart(slot: Slot): number {
    if (useEffectiveSlotLayout && group && rateMemberId) {
      return effectiveWindowMinutes(group, rateMemberId, slot).start;
    }
    return parseHm(slot.start);
  }

  function beginStripResize(
    slot: Slot,
    edge: "start" | "end",
    e: ReactPointerEvent
  ) {
    e.stopPropagation();
    e.preventDefault();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const w = stripWindows[slot.id] ?? {
      planFrom: slot.start,
      planTo: slot.end,
    };
    const sm = parseHm(w.planFrom);
    const em = parseHm(w.planTo);
    if (Number.isNaN(sm) || Number.isNaN(em)) return;
    setStripResize({
      slotId: slot.id,
      edge,
      anchorClientY: e.clientY,
      baseFromM: sm,
      baseToM: em,
      pointerId: e.pointerId,
    });
  }

  const canDragSlotToStrip = Boolean(
    buildPlanner &&
      group &&
      activeDay &&
      !stripResize
  );

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
        <div className="touch-scroll max-h-[min(72vh,calc(100vh-10rem))] overflow-auto border-2 border-zinc-900 bg-white">
          <div
            className={`flex min-h-0 items-stretch ${
              singleCol ? "w-full min-w-0" : "min-w-max"
            }`}
          >
          <div
            className="sticky left-0 z-[100] flex w-16 shrink-0 flex-col border-r-2 border-zinc-900 bg-zinc-50 shadow-[6px_0_12px_-4px_rgba(0,0,0,0.12)] sm:w-14"
            style={{ minHeight: timelineHRender }}
          >
            <div className="sticky top-0 z-[110] h-8 shrink-0 border-b-2 border-zinc-900 bg-zinc-50" />
            <div
              className="relative shrink-0 overflow-hidden"
              style={{ height: timelineBodyPx }}
            >
              {ticksRender.map((m, i) => (
                <div
                  key={m}
                  className="pointer-events-none absolute left-0 right-0 flex items-center border-b border-zinc-200 px-1 text-[11px] font-mono leading-none text-zinc-600"
                  style={{ top: i * pxPerSlot, height: pxPerSlot }}
                >
                  {hhmmFromMinutes(m)}
                </div>
              ))}
            </div>
          </div>
          {buildPlanner && group && activeDay ? (
            <div
              className={
                stripPinned
                  ? "sticky left-16 z-[99] shrink-0 self-start sm:left-14"
                  : "shrink-0"
              }
            >
              <SchedulePlannerStrip
                group={group}
                activeDay={activeDay}
                schedule={schedule}
                plannerMemberId={buildPlanner.memberId}
                stripIds={stripIds}
                setStripIds={setStripIds}
                windows={stripWindows}
                setWindows={setStripWindows}
                stripScope={stripScope}
                setStripScope={setStripScope}
                stripUserAddedIds={stripUserAddedIds}
                onStripUserAddedSlot={(id) =>
                  setStripUserAddedIds((prev) => new Set(prev).add(id))
                }
                onStripUserRemovedUserAdd={(id) =>
                  setStripUserAddedIds((prev) => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                  })
                }
                onApply={buildPlanner.onApplyPlan}
                onStripTimeResize={beginStripResize}
                stripPinned={stripPinned}
                onStripPinnedChange={setStripPinned}
                timelineMinM={minMR}
                timelineMaxM={maxMR}
                timelineBodyPx={timelineBodyPx}
              />
            </div>
          ) : null}
          <div className="relative flex min-h-0 min-w-0 flex-1 w-full">
            <div className="relative flex min-w-0 flex-1 w-full">
              {showEffectivePlanLayer &&
                planWalkBands.map((band, bi) => {
                  const range = maxMR - minMR;
                  if (range <= 0) return null;
                  const topPx = ((band.fromM - minMR) / range) * timelineBodyPx;
                  const durPx =
                    ((band.toM - band.fromM) / range) * timelineBodyPx;
                  const heightPx = Math.max(durPx, 4);
                  return (
                    <div
                      key={`walk-span-${bi}`}
                      className="pointer-events-none absolute left-0 right-0 z-[3] bg-zinc-900/20"
                      style={{
                        top: 32 + topPx,
                        height: heightPx,
                      }}
                      aria-hidden
                    />
                  );
                })}
              <div
                className={`flex min-w-0 flex-1 ${singleCol ? "w-full" : ""}`}
              >
          {stagesToRender.map((stage) => {
            const sortedSlots = [...slotsForStage(stage)].sort(
              (a, b) => layoutSortStart(a) - layoutSortStart(b)
            );
            return (
            <div
              key={stage}
              className={
                singleCol
                  ? "relative min-w-0 flex-1 border-r-2 border-zinc-900"
                  : "relative min-w-[min(100%,140px)] flex-1 border-r-2 border-zinc-900 sm:min-w-[148px]"
              }
              style={{ minHeight: timelineHRender }}
            >
              <div className="sticky top-0 z-20 h-8 border-b-2 border-zinc-900 bg-zinc-100 px-1 text-center text-[11px] font-semibold leading-8 text-zinc-900 shadow-[0_6px_10px_-4px_rgba(0,0,0,0.1)]">
                {singleCol ? "Plan" : stage}
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
                  const onStrip =
                    Boolean(buildPlanner && stripIds.includes(slot.id));
                  const onPlan =
                    !group ||
                    !rateMemberId ||
                    effectiveMemberWantsSlot(group, rateMemberId, slot.id);
                  let topPx: number;
                  let heightPx: number;
                  if (useEffectiveSlotLayout && group && rateMemberId) {
                    const ew = effectiveWindowMinutes(group, rateMemberId, slot);
                    let sm = ew.start;
                    let em = ew.end;
                    const lo = parseHm(slot.start);
                    const hi = parseHm(slot.end);
                    if (!onPlan && !Number.isNaN(lo) && !Number.isNaN(hi)) {
                      sm = lo;
                      em = hi;
                    }
                    const range = maxMR - minMR;
                    if (range <= 0 || Number.isNaN(sm) || Number.isNaN(em)) {
                      topPx = 0;
                      heightPx = 40;
                    } else {
                      topPx = ((sm - minMR) / range) * timelineBodyPx;
                      heightPx = Math.max(
                        ((em - sm) / range) * timelineBodyPx,
                        14
                      );
                    }
                  } else {
                    const layout = slotPixelLayout(
                      sortedSlots,
                      slotIndex,
                      minMR,
                      maxMR,
                      timelineBodyPx
                    );
                    if (!layout) return null;
                    topPx = layout.topPx;
                    heightPx = layout.heightPx;
                  }
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
                    !buildPlanner &&
                      (onSlotOpenDetail || canOpenPanel)
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

                  const ghostOffPlan =
                    useEffectiveSlotLayout &&
                    group &&
                    rateMemberId &&
                    !onPlan;
                  const shellClass = `absolute left-0.5 right-0.5 border-2 px-1 py-0.5 text-left flex min-h-0 flex-col overflow-hidden ${
                    ghostOffPlan
                      ? "border-dashed border-zinc-500 bg-zinc-200/80 opacity-70"
                      : "border-zinc-900 bg-zinc-50"
                  } ${
                    openDetailOrPanel
                      ? "cursor-pointer hover:bg-zinc-100"
                      : ""
                  }`;

                  const ovSegs =
                    clashOverlapIntervalsBySlot.get(slot.id) ?? [];
                  const walkOnlyClash = clashWalkOnlySlotIds.has(slot.id);
                  const showClashStripe = ovSegs.length > 0 || walkOnlyClash;
                  return (
                    <div
                      key={slot.id}
                      draggable={canDragSlotToStrip}
                      onDragStart={
                        canDragSlotToStrip
                          ? (e) => {
                              e.dataTransfer.setData("text/plain", slot.id);
                              e.dataTransfer.effectAllowed = "copyMove";
                            }
                          : undefined
                      }
                      title={`${slot.artistName} ${slot.start}-${slot.end}`}
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
                        zIndex: onStrip ? 12 + slotIndex : 5 + slotIndex,
                      }}
                    >
                      {showClashStripe ? (
                        <div
                          className="pointer-events-none absolute bottom-0 left-0 top-0 z-[8] w-1 bg-red-600/75"
                          aria-hidden
                        />
                      ) : null}
                      {walkOnlyClash ? (
                        <span
                          className="pointer-events-none absolute right-0.5 top-0.5 z-[9] text-[8px] leading-none"
                          aria-hidden
                        >
                          🚶
                        </span>
                      ) : null}
                      <div className="relative z-[2] flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                        <p className="shrink-0 break-words text-[11px] font-semibold leading-snug text-zinc-900 [overflow-wrap:anywhere]">
                          {slot.artistName}
                        </p>
                        {singleCol || hideSlotReactions ? (
                          <p className="shrink-0 text-[9px] font-medium leading-tight text-zinc-600 [overflow-wrap:anywhere]">
                            {slot.stageName}
                          </p>
                        ) : null}

                        {!hideSlotReactions &&
                        (showQuickRate || squadPills.length > 0) ? (
                          <div
                            className="flex flex-wrap items-center gap-1"
                            onClick={stopBubble}
                            onKeyDown={stopBubble}
                          >
                            {showQuickRate ? (
                              <span className="inline-flex flex-wrap gap-0.5">
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
                                      className={`touch-manipulation min-h-9 min-w-9 border px-0.5 text-[11px] leading-none transition-colors sm:min-h-[18px] sm:min-w-[18px] ${
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
                                    className="border border-zinc-300 bg-white px-1 py-px text-[9px] font-medium tabular-nums text-zinc-700"
                                  >
                                    {emoji}
                                    {count}
                                  </span>
                                ))}
                              </span>
                            ) : null}
                          </div>
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
            </div>
          </div>
          </div>
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
              {noteSlot.dayLabel} · {noteSlot.stageName} · {noteSlot.start}-
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
                        className={`min-h-[28px] min-w-[28px] border px-1 text-sm leading-none transition-colors ${
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
                  className="border-2 border-zinc-900 bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
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
