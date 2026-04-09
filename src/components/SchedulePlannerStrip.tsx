"use client";

import type React from "react";
import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";

import { recomputeStripWindowsSequential } from "@/lib/planStripWalk";
import { walkBandsBetweenOrderedActs } from "@/lib/planWalkBands";
import { parseHm } from "@/lib/timeHm";
import {
  clampPlanWindowToSlot,
  stripWindowsInfeasiblePair,
} from "@/lib/walkFeasibility";
import type { FestivalSnapshot } from "@/lib/types";

type Slot = FestivalSnapshot["schedule"][number];

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
  onStripWindowMoveStart?: (slot: Slot, e: ReactMouseEvent) => void;
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

  const range = timelineMaxM - timelineMinM;

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

  function boxLayout(slot: Slot): { topPx: number; heightPx: number } {
    const w = windows[slot.id] ?? { planFrom: slot.start, planTo: slot.end };
    const sm = parseHm(w.planFrom);
    const em = parseHm(w.planTo);
    if (Number.isNaN(sm) || Number.isNaN(em) || range <= 0) {
      return { topPx: 0, heightPx: 28 };
    }
    const topPx = ((sm - timelineMinM) / range) * timelineBodyPx;
    const heightPx = Math.max(((em - sm) / range) * timelineBodyPx, 16);
    return { topPx, heightPx };
  }

  return (
    <div
      className={`flex w-[200px] shrink-0 flex-col border-l-2 border-zinc-900 bg-zinc-50 ${
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
        className="relative w-full border-b border-zinc-200"
        style={{ height: timelineBodyPx, minHeight: 120 }}
      >
        {walkBands.map((band, i) => {
          if (range <= 0) return null;
          const topPx = ((band.fromM - timelineMinM) / range) * timelineBodyPx;
          const heightPx = Math.max(
            ((band.toM - band.fromM) / range) * timelineBodyPx,
            6
          );
          return (
            <div
              key={`w-${i}`}
              className="pointer-events-none absolute left-0 right-0 z-[1] flex items-center justify-center border-y border-sky-700/40 bg-sky-300/50 text-[8px] font-bold text-sky-950"
              style={{ top: topPx, height: heightPx }}
            >
              {band.label}
            </div>
          );
        })}

        {stripIds.length === 0 ? (
          <p className="absolute inset-0 flex items-center justify-center p-1 text-center text-[9px] text-zinc-500">
            Drop acts from the grid
          </p>
        ) : null}

        {orderedSlots.map((slot, idx) => {
          const { topPx, heightPx } = boxLayout(slot);
          const w = windows[slot.id] ?? {
            planFrom: slot.start,
            planTo: slot.end,
          };
          return (
            <div
              key={slot.id}
              className="absolute left-0.5 right-0.5 z-[4] flex flex-col overflow-visible border-2 border-zinc-900 bg-white shadow-sm"
              style={{ top: topPx, height: heightPx }}
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
              <button
                type="button"
                draggable={!resizeBusy && !moveBusy}
                aria-label="Reorder in strip"
                className="h-3 shrink-0 cursor-grab border-b border-zinc-300 bg-zinc-200 text-[8px] leading-3 text-zinc-600 active:cursor-grabbing"
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.setData("text/plain", `reorder:${slot.id}`);
                  e.dataTransfer.effectAllowed = "move";
                }}
              >
                ≡
              </button>
              {onStripTimeResize ? (
                <button
                  type="button"
                  aria-label="Resize plan start"
                  className="h-1.5 shrink-0 cursor-ns-resize border-0 bg-zinc-800/50 p-0 hover:bg-zinc-800/75"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onStripTimeResize(slot, "start", e);
                  }}
                />
              ) : null}
              <div
                className={`flex min-h-0 flex-1 flex-col overflow-hidden px-0.5 py-px ${
                  onStripWindowMoveStart ? "cursor-grab active:cursor-grabbing" : ""
                }`}
                onMouseDown={(e) => {
                  if (
                    !onStripWindowMoveStart ||
                    (e.target as HTMLElement).closest("button,a,input")
                  ) {
                    return;
                  }
                  if (e.button !== 0) return;
                  onStripWindowMoveStart(slot, e);
                }}
              >
                <p className="truncate text-[9px] font-semibold leading-tight text-zinc-900">
                  {slot.artistName}
                </p>
                <p className="truncate text-[8px] text-zinc-600">
                  {slot.stageName}
                </p>
                <p className="mt-auto font-mono text-[8px] text-zinc-700">
                  {w.planFrom}–{w.planTo}
                </p>
              </div>
              {onStripTimeResize ? (
                <button
                  type="button"
                  aria-label="Resize plan end"
                  className="h-1.5 shrink-0 cursor-ns-resize border-0 bg-zinc-800/50 p-0 hover:bg-zinc-800/75"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onStripTimeResize(slot, "end", e);
                  }}
                />
              ) : null}
              <button
                type="button"
                className="absolute right-0 top-3 z-10 border border-zinc-400 bg-white px-0.5 text-[8px] leading-none text-red-800"
                title="Remove from strip"
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
        {clash && !allowClashes ? (
          <p className="mb-1 border border-red-300 bg-red-50 p-1 text-[9px] text-red-900">
            Overlap or not enough travel time.
          </p>
        ) : null}
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
    </div>
  );
}
