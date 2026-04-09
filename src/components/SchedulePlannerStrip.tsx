"use client";

import type React from "react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { recomputeStripWindowsSequential } from "@/lib/planStripWalk";
import { walkBandsBetweenOrderedActs } from "@/lib/planWalkBands";
import { parseHm } from "@/lib/timeHm";
import {
  clampPlanWindowToSlot,
  stripWindowsInfeasiblePair,
} from "@/lib/walkFeasibility";
import type { FestivalSnapshot } from "@/lib/types";

type Slot = FestivalSnapshot["schedule"][number];

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
  stripIds,
  setStripIds,
  windows,
  setWindows,
  allowClashes,
  stripScope,
  setStripScope,
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
  stripIds: string[];
  setStripIds: React.Dispatch<React.SetStateAction<string[]>>;
  windows: Record<string, { planFrom: string; planTo: string }>;
  setWindows: React.Dispatch<
    React.SetStateAction<Record<string, { planFrom: string; planTo: string }>>
  >;
  allowClashes: boolean;
  stripScope: "mine" | "group";
  setStripScope: (v: "mine" | "group") => void;
  onStripTimeResize?: (
    slot: Slot,
    edge: "start" | "end",
    e: ReactMouseEvent
  ) => void;
  onStripWindowMoveStart?: (slot: Slot, anchorClientY: number) => void;
  resizeBusy?: boolean;
  moveBusy?: boolean;
  timelineMinM: number;
  timelineMaxM: number;
  timelineBodyPx: number;
  onApply: (
    patches: {
      slotId: string;
      wants: boolean;
      planFrom: string | null;
      planTo: string | null;
    }[]
  ) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const editDialogRef = useRef<HTMLDialogElement>(null);

  const slotsById = useMemo(() => {
    const m = new Map(schedule.map((s) => [s.id, s]));
    return m;
  }, [schedule]);

  const orderedSlots = stripIds
    .map((id) => slotsById.get(id))
    .filter((s): s is Slot => Boolean(s));

  const clash = useMemo(
    () =>
      stripWindowsInfeasiblePair(
        group,
        orderedSlots,
        windows,
        allowClashes
      ),
    [group, orderedSlots, windows, allowClashes]
  );

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
    const next = [...stripIds, id];
    setStripIds(next);
    syncWindowsForOrder(next);
  }

  async function save() {
    if (clash && !allowClashes) return;
    const patches = stripIds.map((id) => {
      const s = slotsById.get(id)!;
      const w = windows[id] ?? { planFrom: s.start, planTo: s.end };
      const c = clampPlanWindowToSlot(s, w.planFrom, w.planTo);
      return {
        slotId: id,
        wants: true,
        planFrom: c.planFrom,
        planTo: c.planTo,
      };
    });
    if (!patches.length) return;
    setBusy(true);
    try {
      await onApply(patches);
    } finally {
      setBusy(false);
    }
  }

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
    if (e.button !== 0) return;
    const t = e.target as HTMLElement | null;
    if (
      t?.closest(
        "button,a,input,textarea,[data-strip-resize],[data-strip-drag]"
      )
    )
      return;
    const y0 = e.clientY;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - y0) < 8) return;
      moved = true;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onStripWindowMoveStart(slot, y0);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!moved) setEditId(slot.id);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  const dialogSlot = editId ? slotsById.get(editId) ?? null : null;

  return (
    <div
      className={`flex w-[min(280px,32vw)] min-w-[220px] shrink-0 flex-col border-l-2 border-zinc-900 bg-zinc-50 ${
        dragOver ? "ring-2 ring-zinc-900 ring-offset-1" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => void onDropStrip(e)}
    >
      <div className="sticky top-0 z-50 border-b-2 border-zinc-900 bg-zinc-100 px-1 py-1 text-center text-[10px] font-bold leading-tight text-zinc-900">
        Plan strip
        <div className="mt-1 flex gap-0.5">
          <button
            type="button"
            className={`flex-1 border px-0.5 py-px text-[9px] font-semibold ${
              stripScope === "mine"
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-600 bg-white text-zinc-800"
            }`}
            onClick={() => setStripScope("mine")}
          >
            My plan
          </button>
          <button
            type="button"
            className={`flex-1 border px-0.5 py-px text-[9px] font-semibold ${
              stripScope === "group"
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-600 bg-white text-zinc-800"
            }`}
            onClick={() => setStripScope("group")}
          >
            Group
          </button>
        </div>
      </div>

      <div
        className="relative w-full overflow-hidden border-b border-zinc-200"
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
                data-strip-drag
                draggable={!resizeBusy && !moveBusy}
                aria-label="Reorder in strip"
                className="absolute bottom-0 left-0 top-0 z-[26] flex w-2 cursor-grab items-center justify-center border-r border-zinc-200 bg-zinc-100/90 active:cursor-grabbing"
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.setData("text/plain", `reorder:${slot.id}`);
                  e.dataTransfer.effectAllowed = "move";
                }}
              >
                <span className="select-none text-[9px] leading-none text-zinc-400">
                  ⋮
                </span>
              </div>
              <div className="relative min-h-0 flex-1 pl-2">
                {onStripTimeResize ? (
                  <div
                    data-strip-resize="start"
                    className="absolute left-0 right-0 top-0 z-20 h-1.5 cursor-ns-resize"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onStripTimeResize(slot, "start", e);
                    }}
                  />
                ) : null}
                <div
                  className={`flex h-full min-h-0 flex-col justify-start gap-px overflow-y-auto overflow-x-hidden px-0.5 pb-1.5 pt-1.5 ${
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
                    className="absolute bottom-0 left-0 right-0 z-20 h-1.5 cursor-ns-resize"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onStripTimeResize(slot, "end", e);
                    }}
                  />
                ) : null}
              </div>
              <button
                type="button"
                className="absolute right-0.5 top-0.5 z-[25] border border-zinc-400 bg-white px-0.5 text-[9px] leading-none text-red-800"
                onClick={(e) => {
                  e.stopPropagation();
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
            </div>
          );
        })}
      </div>

      <div className="border-t border-zinc-300 p-1">
        <button
          type="button"
          className="mb-1 w-full text-[9px] text-red-800 underline"
          disabled={!stripIds.length}
          onClick={() => {
            setStripIds([]);
            setWindows({});
          }}
        >
          Clear strip
        </button>
        <button
          type="button"
          disabled={
            busy ||
            stripIds.length === 0 ||
            (Boolean(clash) && !allowClashes)
          }
          onClick={() => void save()}
          className="w-full border-2 border-zinc-900 bg-[var(--accent)] py-1 text-[10px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? "…" : "Apply to plan"}
        </button>
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
