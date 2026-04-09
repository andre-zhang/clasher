"use client";

import type React from "react";
import { useMemo, useState } from "react";

import { clampPlanWindowToSlot, stripWindowsInfeasiblePair } from "@/lib/walkFeasibility";
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
  onApply,
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

  function ensureWindow(slot: Slot) {
    setWindows((prev) => {
      if (prev[slot.id]) return prev;
      return {
        ...prev,
        [slot.id]: { planFrom: slot.start, planTo: slot.end },
      };
    });
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
    setStripIds([...stripIds, id]);
    ensureWindow(slot);
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

  return (
    <div
      className={`flex w-[200px] shrink-0 flex-col border-l-2 border-zinc-900 bg-amber-50 ${
        dragOver ? "ring-2 ring-indigo-500" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => onDropStrip(e)}
    >
      <div className="sticky top-0 z-[1] h-8 border-b-2 border-zinc-900 bg-amber-100 px-1 text-center text-[10px] font-bold leading-8 text-zinc-900">
        Plan strip
      </div>
      <div className="flex max-h-[min(70vh,520px)] flex-1 flex-col gap-1 overflow-y-auto p-1">
        {stripIds.length === 0 ? (
          <p className="text-[9px] text-zinc-600">Drop acts here</p>
        ) : null}
        {orderedSlots.map((slot, idx) => {
          const w = windows[slot.id] ?? {
            planFrom: slot.start,
            planTo: slot.end,
          };
          return (
            <div
              key={slot.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", `reorder:${slot.id}`);
                e.dataTransfer.effectAllowed = "move";
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
              }}
              className="border border-zinc-800 bg-white p-1 text-[10px] shadow-none"
            >
              <p className="font-semibold leading-tight text-zinc-900">
                {slot.artistName}
              </p>
              <div className="mt-1 flex flex-col gap-0.5 font-mono">
                <label className="flex items-center gap-0.5">
                  <span className="text-zinc-500">In</span>
                  <input
                    className="w-full border border-zinc-400 px-0.5 text-[9px]"
                    value={w.planFrom}
                    onChange={(e) =>
                      setWindows((p) => ({
                        ...p,
                        [slot.id]: {
                          planFrom: e.target.value,
                          planTo: w.planTo,
                        },
                      }))
                    }
                  />
                </label>
                <label className="flex items-center gap-0.5">
                  <span className="text-zinc-500">Out</span>
                  <input
                    className="w-full border border-zinc-400 px-0.5 text-[9px]"
                    value={w.planTo}
                    onChange={(e) =>
                      setWindows((p) => ({
                        ...p,
                        [slot.id]: {
                          planFrom: w.planFrom,
                          planTo: e.target.value,
                        },
                      }))
                    }
                  />
                </label>
              </div>
              <button
                type="button"
                className="mt-1 text-[9px] text-red-800 underline"
                onClick={() =>
                  setStripIds((ids) => ids.filter((x) => x !== slot.id))
                }
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
      {clash && !allowClashes ? (
        <p className="border-t border-red-200 bg-red-50 p-1 text-[9px] text-red-900">
          Overlap or not enough travel time.
        </p>
      ) : null}
      <div className="border-t border-zinc-300 p-1">
        <button
          type="button"
          disabled={
            busy ||
            stripIds.length === 0 ||
            (Boolean(clash) && !allowClashes)
          }
          onClick={() => void save()}
          className="w-full border-2 border-zinc-900 bg-indigo-600 py-1 text-[10px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? "…" : "Apply to plan"}
        </button>
      </div>
    </div>
  );
}
