"use client";

import type React from "react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { effectiveMemberWantsSlot } from "@/lib/effectiveIntents";
import { recomputeStripWindowsSequential } from "@/lib/planStripWalk";
import { walkBandsBetweenOrderedActs } from "@/lib/planWalkBands";
import { parseHm } from "@/lib/timeHm";
import { clampPlanWindowToSlot } from "@/lib/walkFeasibility";
import type { FestivalSnapshot } from "@/lib/types";

type Slot = FestivalSnapshot["schedule"][number];

/** Invisible hit band on top/bottom border; ≥12px for touch targets (WCAG). */
const STRIP_EDGE_HIT_PX = 14;

type IntentPatch = {
  slotId: string;
  wants: boolean;
  planFrom: string | null;
  planTo: string | null;
};

function patchNeedsApply(
  group: FestivalSnapshot,
  memberId: string,
  patch: IntentPatch,
  slot: Slot | undefined
): boolean {
  const row = group.allMemberSlotIntents.find(
    (i) => i.memberId === memberId && i.slotId === patch.slotId
  );
  if (!patch.wants) {
    return Boolean(row?.wants);
  }
  if (!slot) return true;
  if (!row?.wants) return true;
  const rf = row.planFrom ?? slot.start;
  const rt = row.planTo ?? slot.end;
  return rf !== patch.planFrom || rt !== patch.planTo;
}

function stripBoxLayout(
  slot: Slot,
  wins: Record<string, { planFrom: string; planTo: string }>,
  timelineMinM: number,
  timelineMaxM: number,
  timelineBodyPx: number
): { topPx: number; heightPx: number } {
  const range = timelineMaxM - timelineMinM;
  const w = wins[slot.id] ?? { planFrom: slot.start, planTo: slot.end };
  const sm = parseHm(w.planFrom);
  const em = parseHm(w.planTo);
  if (Number.isNaN(sm) || Number.isNaN(em) || range <= 0) {
    return { topPx: 0, heightPx: 28 };
  }
  const topPx = ((sm - timelineMinM) / range) * timelineBodyPx;
  // Tall enough for edge resize hit areas + two text lines (avoids overflow on short slots).
  const heightPx = Math.max(((em - sm) / range) * timelineBodyPx, 40);
  return { topPx, heightPx };
}

export function SchedulePlannerStrip({
  group,
  activeDay,
  schedule,
  plannerMemberId,
  stripIds,
  setStripIds,
  windows,
  setWindows,
  stripScope,
  setStripScope,
  stripUserAddedIds,
  onStripUserAddedSlot,
  onStripUserRemovedUserAdd,
  onApply,
  onStripTimeResize,
  stripPinned,
  onStripPinnedChange,
  timelineMinM,
  timelineMaxM,
  timelineBodyPx,
}: {
  group: FestivalSnapshot;
  activeDay: string;
  schedule: FestivalSnapshot["schedule"];
  plannerMemberId: string;
  stripIds: string[];
  setStripIds: React.Dispatch<React.SetStateAction<string[]>>;
  windows: Record<string, { planFrom: string; planTo: string }>;
  setWindows: React.Dispatch<
    React.SetStateAction<Record<string, { planFrom: string; planTo: string }>>
  >;
  stripScope: "mine" | "group";
  setStripScope: (v: "mine" | "group") => void;
  /** In group mode: slots the user added from the grid (not yet on server wants). */
  stripUserAddedIds: Set<string>;
  onStripUserAddedSlot?: (slotId: string) => void;
  onStripUserRemovedUserAdd?: (slotId: string) => void;
  onStripTimeResize?: (
    slot: Slot,
    edge: "start" | "end",
    e: ReactPointerEvent
  ) => void;
  /** When true, outer calendar keeps this column pinned like the time rail while scrolling. */
  stripPinned?: boolean;
  onStripPinnedChange?: (pinned: boolean) => void;
  timelineMinM: number;
  timelineMaxM: number;
  timelineBodyPx: number;
  onApply: (patches: IntentPatch[]) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const editDialogRef = useRef<HTMLDialogElement>(null);
  const groupRef = useRef(group);
  groupRef.current = group;
  const lastSuccessfulSaveIdsRef = useRef<string[]>([]);
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;

  useEffect(() => {
    lastSuccessfulSaveIdsRef.current = [];
  }, [activeDay, plannerMemberId, stripScope]);

  const daySlots = useMemo(
    () =>
      schedule.filter((s) => s.dayLabel.trim() === activeDay.trim()),
    [schedule, activeDay]
  );

  const myEffectiveWantedIds = useMemo(() => {
    const s = new Set<string>();
    for (const slot of daySlots) {
      if (effectiveMemberWantsSlot(group, plannerMemberId, slot.id)) {
        s.add(slot.id);
      }
    }
    return s;
  }, [daySlots, group, plannerMemberId]);

  const mySaveOrdered = useMemo(() => {
    if (stripScope === "mine") return stripIds;
    return stripIds.filter(
      (id) => myEffectiveWantedIds.has(id) || stripUserAddedIds.has(id)
    );
  }, [stripScope, stripIds, myEffectiveWantedIds, stripUserAddedIds]);

  const mySaveSig = mySaveOrdered.join("\0");
  const windowsSig = useMemo(() => {
    const keys = Object.keys(windows).sort();
    return keys.map((k) => `${k}\t${windows[k]!.planFrom}\t${windows[k]!.planTo}`).join("\0");
  }, [windows]);

  const slotsById = useMemo(() => {
    const m = new Map(schedule.map((s) => [s.id, s]));
    return m;
  }, [schedule]);

  const orderedSlots = stripIds
    .map((id) => slotsById.get(id))
    .filter((s): s is Slot => Boolean(s));

  const walkBands = useMemo(
    () => walkBandsBetweenOrderedActs(group, orderedSlots, windows),
    [group, orderedSlots, windows]
  );

  const stripColumnPack = useMemo(() => {
    const items = orderedSlots.map((slot) => {
      const { topPx, heightPx } = stripBoxLayout(
        slot,
        windows,
        timelineMinM,
        timelineMaxM,
        timelineBodyPx
      );
      return { slot, topPx, heightPx, bot: topPx + heightPx };
    });
    const n = items.length;
    const parent = items.map((_, i) => i);
    function find(i: number): number {
      let x = i;
      while (parent[x] !== x) x = parent[x]!;
      return x;
    }
    function union(a: number, b: number) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const A = items[i]!;
        const B = items[j]!;
        if (A.topPx < B.bot && B.topPx < A.bot) union(i, j);
      }
    }
    const clusters = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      const arr = clusters.get(r) ?? [];
      arr.push(i);
      clusters.set(r, arr);
    }
    const colOf = new Map<string, { col: number; cols: number }>();
    for (const idxs of clusters.values()) {
      idxs.sort((a, b) => items[a]!.topPx - items[b]!.topPx);
      const cols = idxs.length;
      idxs.forEach((idx, ord) => {
        colOf.set(items[idx]!.slot.id, { col: ord, cols });
      });
    }
    return { items, colOf };
  }, [orderedSlots, windows, timelineMinM, timelineMaxM, timelineBodyPx]);

  const itemById = useMemo(
    () => new Map(stripColumnPack.items.map((x) => [x.slot.id, x])),
    [stripColumnPack.items]
  );

  useEffect(() => {
    if (!editId) {
      editDialogRef.current?.close();
      return;
    }
    const slot = slotsById.get(editId);
    if (!slot) {
      setEditId(null);
      return;
    }
    const w = windows[slot.id] ?? {
      planFrom: slot.start,
      planTo: slot.end,
    };
    setDraftFrom(w.planFrom);
    setDraftTo(w.planTo);
    editDialogRef.current?.showModal();
  }, [editId, windows, slotsById]);

  function syncWindowsForOrder(nextIds: string[]) {
    setWindows(recomputeStripWindowsSequential(group, nextIds, schedule));
  }

  function onDropStrip(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const id = e.dataTransfer.getData("text/plain");
    if (!id || id.startsWith("reorder:")) return;
    if (slotsById.get(id)?.dayLabel.trim() !== activeDay.trim()) return;
    if (stripIds.includes(id)) return;
    const slot = slotsById.get(id);
    if (!slot) return;
    if (stripScope === "group") {
      onStripUserAddedSlot?.(id);
    }
    const next = [...stripIds, id];
    setStripIds(next);
    syncWindowsForOrder(next);
  }

  useEffect(() => {
    const saveOrdered = mySaveOrdered;
    const t = window.setTimeout(() => {
      const g = groupRef.current;
      const winsSeq = recomputeStripWindowsSequential(
        g,
        saveOrdered,
        schedule
      );
      const prev = new Set(lastSuccessfulSaveIdsRef.current);
      const next = new Set(saveOrdered);
      const patches: IntentPatch[] = [];
      for (const id of prev) {
        if (!next.has(id)) {
          patches.push({
            slotId: id,
            wants: false,
            planFrom: null,
            planTo: null,
          });
        }
      }
      for (const id of saveOrdered) {
        const s = slotsById.get(id);
        if (!s) continue;
        const fromUi = windows[id];
        const fromSeq = winsSeq[id];
        const w =
          fromUi ?? fromSeq ?? { planFrom: s.start, planTo: s.end };
        const c = clampPlanWindowToSlot(s, w.planFrom, w.planTo);
        patches.push({
          slotId: id,
          wants: true,
          planFrom: c.planFrom,
          planTo: c.planTo,
        });
      }
      const toSend = patches.filter((p) =>
        patchNeedsApply(g, plannerMemberId, p, slotsById.get(p.slotId))
      );
      if (!toSend.length) {
        lastSuccessfulSaveIdsRef.current = [...saveOrdered];
        return;
      }
      setBusy(true);
      void (async () => {
        try {
          await onApplyRef.current(toSend);
          lastSuccessfulSaveIdsRef.current = [...saveOrdered];
        } finally {
          setBusy(false);
        }
      })();
    }, 500);
    return () => window.clearTimeout(t);
  }, [mySaveSig, windowsSig, plannerMemberId, slotsById, schedule]);

  function applyDraftTimes() {
    if (!editId) return;
    const slot = slotsById.get(editId);
    if (!slot) return;
    const c = clampPlanWindowToSlot(slot, draftFrom.trim(), draftTo.trim());
    setWindows((prev) => ({
      ...prev,
      [slot.id]: { planFrom: c.planFrom, planTo: c.planTo },
    }));
    setEditId(null);
  }

  function bodyPointerDown(slot: Slot, e: React.PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest("button,a,input,textarea,[data-strip-resize]")) return;
    const y0 = e.clientY;
    const pid = e.pointerId;
    let dragLikely = false;

    function onUp(ev: PointerEvent) {
      if (ev.pointerId !== pid) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!dragLikely) setEditId(slot.id);
    }

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pid) return;
      if (Math.abs(ev.clientY - y0) >= 10) {
        dragLikely = true;
        window.removeEventListener("pointermove", onMove);
      }
    }
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  const dialogSlot = editId ? slotsById.get(editId) ?? null : null;

  return (
    <div
      className={`flex w-[min(78vw,188px)] min-w-[118px] max-w-[200px] shrink-0 flex-col border-r-2 border-zinc-900 bg-zinc-50 sm:w-[min(22vw,176px)] sm:min-w-[128px] sm:max-w-[188px] ${
        dragOver ? "ring-2 ring-zinc-900 ring-offset-1" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => void onDropStrip(e)}
    >
      <div className="sticky top-0 z-50 flex h-8 shrink-0 items-center gap-1 border-b-2 border-zinc-900 bg-zinc-100 px-1">
        <span className="text-[10px] font-bold leading-none text-zinc-900">
          Plan
        </span>
        {onStripPinnedChange ? (
          <button
            type="button"
            title={
              stripPinned
                ? "Unpin strip (scrolls away horizontally)"
                : "Pin strip next to times while scrolling"
            }
            className={`touch-manipulation border px-1 py-0.5 text-[8px] font-semibold leading-none ${
              stripPinned
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-500 bg-white text-zinc-700"
            }`}
            onClick={() => onStripPinnedChange(!stripPinned)}
          >
            Pin
          </button>
        ) : null}
        <div className="ml-auto flex gap-0.5">
          <button
            type="button"
            className={`touch-manipulation border px-2 py-1.5 text-[9px] font-semibold leading-none sm:px-1 sm:py-0.5 ${
              stripScope === "mine"
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-600 bg-white text-zinc-800"
            }`}
            onClick={() => setStripScope("mine")}
          >
            Mine
          </button>
          <button
            type="button"
            className={`touch-manipulation border px-2 py-1.5 text-[9px] font-semibold leading-none sm:px-1 sm:py-0.5 ${
              stripScope === "group"
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-600 bg-white text-zinc-800"
            }`}
            onClick={() => setStripScope("group")}
          >
            Everyone
          </button>
        </div>
      </div>

      <div
        className="relative w-full touch-pan-y overflow-hidden overscroll-y-contain border-b border-zinc-200 [-webkit-tap-highlight-color:transparent]"
        style={{ height: timelineBodyPx, minHeight: 120 }}
      >
        {walkBands.map((band, i) => {
          const range = timelineMaxM - timelineMinM;
          if (range <= 0) return null;
          const topPx = ((band.fromM - timelineMinM) / range) * timelineBodyPx;
          const durPx =
            ((band.toM - band.fromM) / range) * timelineBodyPx;
          const heightPx = Math.max(durPx, 3);
          return (
            <div
              key={`w-${i}`}
              className="pointer-events-none absolute left-0 right-0 z-[1] bg-zinc-900/25"
              style={{ top: topPx, height: heightPx }}
              aria-hidden
            />
          );
        })}

        {orderedSlots.map((slot) => {
          const packItem = itemById.get(slot.id);
          if (!packItem) return null;
          const canRemoveFromMyPlan =
            stripScope === "mine" ||
            myEffectiveWantedIds.has(slot.id) ||
            stripUserAddedIds.has(slot.id);
          const { topPx, heightPx } = packItem;
          const pack = stripColumnPack.colOf.get(slot.id) ?? {
            col: 0,
            cols: 1,
          };
          const { col, cols } = pack;
          const gap = 3;
          const widthPct = 100 / cols;
          const leftPct = col * widthPct;
          const edgeHitH = Math.min(
            STRIP_EDGE_HIT_PX,
            Math.max(8, Math.floor((heightPx - 6) / 2))
          );
          const wCur = windows[slot.id] ?? {
            planFrom: slot.start,
            planTo: slot.end,
          };
          const slotLoM = parseHm(slot.start);
          const slotHiM = parseHm(slot.end);
          let planFromM = parseHm(wCur.planFrom);
          let planToM = parseHm(wCur.planTo);
          if (Number.isNaN(planFromM)) planFromM = slotLoM;
          if (Number.isNaN(planToM)) planToM = slotHiM;
          let ariaMin = 0;
          let ariaMax = 1439;
          if (!Number.isNaN(slotLoM) && !Number.isNaN(slotHiM)) {
            ariaMin = Math.min(slotLoM, slotHiM);
            ariaMax = Math.max(slotLoM, slotHiM);
          } else if (!Number.isNaN(slotLoM)) {
            ariaMin = slotLoM;
            ariaMax = slotLoM;
          } else if (!Number.isNaN(slotHiM)) {
            ariaMin = slotHiM;
            ariaMax = slotHiM;
          }
          return (
            <div
              key={slot.id}
              className="absolute z-[4] flex flex-col overflow-visible border-2 border-zinc-900 bg-white shadow-sm"
              style={{
                top: topPx,
                height: heightPx,
                left: `calc(${leftPct}% + ${gap}px)`,
                width: `calc(${widthPct}% - ${gap * 2}px)`,
              }}
            >
              <div className="relative min-h-0 flex-1 overflow-hidden">
                {onStripTimeResize ? (
                  <div
                    data-strip-resize="start"
                    role="slider"
                    aria-label="Drag to adjust arrival time (not before set start)"
                    aria-valuemin={ariaMin}
                    aria-valuemax={ariaMax}
                    aria-valuenow={
                      Number.isNaN(planFromM)
                        ? ariaMin
                        : Math.round(
                            Math.min(ariaMax, Math.max(ariaMin, planFromM))
                          )
                    }
                    title="Drag to adjust arrival"
                    className="absolute inset-x-[-2px] top-[-2px] z-[32] flex cursor-ns-resize touch-none select-none items-start justify-center bg-transparent pt-0.5"
                    style={{
                      height: edgeHitH,
                      touchAction: "none",
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                      } catch {
                        /* ignore */
                      }
                      onStripTimeResize(slot, "start", e);
                    }}
                  >
                    <span
                      className="pointer-events-none h-0.5 w-7 rounded-full bg-zinc-400"
                      aria-hidden
                    />
                  </div>
                ) : null}
                {onStripTimeResize ? (
                  <div
                    data-strip-resize="end"
                    role="slider"
                    aria-label="Drag to adjust departure time (not after set end)"
                    aria-valuemin={ariaMin}
                    aria-valuemax={ariaMax}
                    aria-valuenow={
                      Number.isNaN(planToM)
                        ? ariaMax
                        : Math.round(
                            Math.min(ariaMax, Math.max(ariaMin, planToM))
                          )
                    }
                    title="Drag to adjust departure"
                    className="absolute inset-x-[-2px] bottom-[-2px] z-[32] flex cursor-ns-resize touch-none select-none items-end justify-center bg-transparent pb-0.5"
                    style={{
                      height: edgeHitH,
                      touchAction: "none",
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                      } catch {
                        /* ignore */
                      }
                      onStripTimeResize(slot, "end", e);
                    }}
                  >
                    <span
                      className="pointer-events-none h-0.5 w-7 rounded-full bg-zinc-400"
                      aria-hidden
                    />
                  </div>
                ) : null}
                <div
                  className="relative z-[5] flex h-full min-h-0 flex-row items-start gap-1 py-1 pl-1 pr-7 text-left touch-manipulation"
                  onPointerDown={(e) => bodyPointerDown(slot, e)}
                >
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col items-stretch justify-center gap-0.5 text-left">
                    <p className="w-full select-none text-left text-[11px] font-bold leading-tight text-zinc-900 [overflow-wrap:anywhere]">
                      {slot.artistName}
                    </p>
                    <p className="w-full max-w-full shrink-0 text-left text-[8px] leading-tight text-zinc-500 [overflow-wrap:anywhere]">
                      {slot.stageName}
                    </p>
                  </div>
                </div>
              </div>
              {canRemoveFromMyPlan ? (
                <button
                  type="button"
                  className="touch-manipulation absolute right-1 top-1 z-[35] flex h-7 w-7 items-center justify-center border border-zinc-400 bg-white text-[13px] font-semibold leading-none text-red-800 sm:right-0.5 sm:top-0.5 sm:h-6 sm:w-6 sm:text-xs"
                  aria-label="Remove from strip"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (stripUserAddedIds.has(slot.id)) {
                      onStripUserRemovedUserAdd?.(slot.id);
                    }
                    setStripIds((ids) => {
                      const next = ids.filter((x) => x !== slot.id);
                      setWindows(
                        recomputeStripWindowsSequential(group, next, schedule)
                      );
                      return next;
                    });
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="border-t border-zinc-300 p-1">
        <button
          type="button"
          className="touch-manipulation mb-0.5 w-full py-2 text-[9px] text-red-800 underline sm:py-0"
          disabled={!stripIds.length}
          onClick={() => {
            setStripIds([]);
            setWindows({});
          }}
        >
          Clear strip
        </button>
        {busy ? (
          <p className="text-center text-[9px] text-zinc-500" aria-live="polite">
            Saving…
          </p>
        ) : null}
      </div>

      <dialog
        ref={editDialogRef}
        className="max-w-sm border-2 border-zinc-900 bg-white p-3 shadow-[4px_4px_0_0_#18181b]"
        onClose={() => setEditId(null)}
      >
        {dialogSlot ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              applyDraftTimes();
            }}
          >
            <p className="text-xs font-bold text-zinc-900">
              {dialogSlot.artistName}
            </p>
            <p className="font-mono text-[10px] text-zinc-600">
              {dialogSlot.start}-{dialogSlot.end} · {dialogSlot.stageName}
            </p>
            <label className="block text-[10px] font-medium text-zinc-800">
              From
              <input
                className="mt-0.5 w-full border-2 border-zinc-900 px-1 py-0.5 font-mono text-xs"
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="block text-[10px] font-medium text-zinc-800">
              To
              <input
                className="mt-0.5 w-full border-2 border-zinc-900 px-1 py-0.5 font-mono text-xs"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                className="border border-zinc-400 px-2 py-1 text-[10px]"
                onClick={() => setEditId(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="border-2 border-zinc-900 bg-zinc-900 px-2 py-1 text-[10px] font-semibold text-white"
              >
                OK
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
