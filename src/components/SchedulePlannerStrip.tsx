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
  const heightPx = Math.max(((em - sm) / range) * timelineBodyPx, 20);
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
  onStripWindowMoveStart,
  resizeBusy,
  moveBusy,
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
  onStripWindowMoveStart?: (
    slot: Slot,
    anchorClientY: number,
    pointerId: number
  ) => void;
  resizeBusy?: boolean;
  moveBusy?: boolean;
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

  function moveStripSlot(slotId: string, delta: -1 | 1) {
    const i = stripIds.indexOf(slotId);
    if (i < 0) return;
    const j = i + delta;
    if (j < 0 || j >= stripIds.length) return;
    const next = [...stripIds];
    const [removed] = next.splice(i, 1);
    next.splice(j, 0, removed!);
    setStripIds(next);
    syncWindowsForOrder(next);
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
    if (!onStripWindowMoveStart) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const t = e.target as HTMLElement | null;
    if (
      t?.closest(
        "button,a,input,textarea,[data-strip-resize],[data-strip-drag],[data-strip-reorder]"
      )
    )
      return;
    const y0 = e.clientY;
    const pid = e.pointerId;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (Math.abs(ev.clientY - y0) < 10) return;
      moved = true;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      onStripWindowMoveStart(slot, y0, pid);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!moved) setEditId(slot.id);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  const dialogSlot = editId ? slotsById.get(editId) ?? null : null;

  return (
    <div
      className={`flex w-[min(92vw,280px)] min-w-[176px] max-w-[300px] shrink-0 flex-col border-r-2 border-zinc-900 bg-zinc-50 sm:w-[min(260px,38vw)] sm:min-w-[200px] ${
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
        className="relative w-full touch-pan-y overflow-hidden border-b border-zinc-200"
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

        {orderedSlots.map((slot, idx) => {
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
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const raw = e.dataTransfer.getData("text/plain");
                if (!raw.startsWith("reorder:")) return;
                const dragId = raw.slice(8);
                if (dragId === slot.id) return;
                const from = stripIds.indexOf(dragId);
                const to = idx;
                if (from < 0) return;
                const next = [...stripIds];
                next.splice(from, 1);
                next.splice(to, 0, dragId);
                setStripIds(next);
                syncWindowsForOrder(next);
              }}
            >
              <div
                data-strip-reorder
                className="absolute bottom-0 left-0 top-0 z-[26] flex flex-row border-r border-zinc-200 bg-zinc-100/90"
              >
                <div className="flex w-10 shrink-0 flex-col border-r border-zinc-200 md:hidden">
                  <button
                    type="button"
                    className="touch-manipulation flex min-h-10 flex-1 items-center justify-center border-b border-zinc-200 text-xs font-bold text-zinc-700"
                    aria-label="Move earlier in plan"
                    disabled={idx === 0 || resizeBusy || moveBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveStripSlot(slot.id, -1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="touch-manipulation flex min-h-10 flex-1 items-center justify-center text-xs font-bold text-zinc-700"
                    aria-label="Move later in plan"
                    disabled={
                      idx >= stripIds.length - 1 || resizeBusy || moveBusy
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      moveStripSlot(slot.id, 1);
                    }}
                  >
                    ↓
                  </button>
                </div>
                <div
                  data-strip-drag
                  draggable={!resizeBusy && !moveBusy}
                  aria-label="Reorder in strip"
                  className="hidden min-h-[2.5rem] w-7 min-w-[28px] shrink-0 cursor-grab touch-none select-none items-center justify-center border-r border-zinc-200 active:cursor-grabbing md:flex"
                  onDragStart={(e) => {
                    e.stopPropagation();
                    e.dataTransfer.setData("text/plain", `reorder:${slot.id}`);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                >
                  <span className="pointer-events-none text-[11px] leading-none text-zinc-500">
                    ⋮⋮
                  </span>
                </div>
              </div>
              <div className="relative min-h-0 flex-1 pl-10 md:pl-8">
                {onStripTimeResize ? (
                  <div
                    data-strip-resize="start"
                    className="absolute left-0 right-0 top-0 z-30 min-h-10 cursor-ns-resize touch-none sm:min-h-8"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onStripTimeResize(slot, "start", e);
                    }}
                  />
                ) : null}
                <div
                  className={`flex h-full min-h-0 flex-col justify-start gap-px overflow-y-auto overflow-x-hidden px-0.5 pb-1.5 pt-1.5 touch-manipulation ${
                    onStripWindowMoveStart
                      ? "cursor-grab active:cursor-grabbing"
                      : ""
                  }`}
                  onPointerDown={(e) => bodyPointerDown(slot, e)}
                >
                  <p className="text-[11px] font-bold leading-[1.15] text-zinc-900 [overflow-wrap:anywhere]">
                    {slot.artistName}
                  </p>
                  <p className="text-[8px] leading-tight text-zinc-500 [overflow-wrap:anywhere]">
                    {slot.stageName}
                  </p>
                </div>
                {onStripTimeResize ? (
                  <div
                    data-strip-resize="end"
                    className="absolute bottom-0 left-0 right-0 z-30 min-h-10 cursor-ns-resize touch-none sm:min-h-8"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onStripTimeResize(slot, "end", e);
                    }}
                  />
                ) : null}
              </div>
              {canRemoveFromMyPlan ? (
                <button
                  type="button"
                  className="touch-manipulation absolute right-0.5 top-0.5 z-[25] flex h-8 min-h-8 min-w-8 items-center justify-center border border-zinc-400 bg-white text-sm leading-none text-red-800"
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
              {dialogSlot.start}–{dialogSlot.end} · {dialogSlot.stageName}
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
