"use client";

import { useMemo } from "react";

import { effectiveMemberWantsSlot } from "@/lib/effectiveIntents";
import { effectiveWindowMinutes } from "@/lib/planMemberDay";
import { hhmmFromMinutes, parseHm } from "@/lib/timeHm";
import type { FestivalSnapshot } from "@/lib/types";

type Slot = FestivalSnapshot["schedule"][0];

const pxPerSlot = 28;

export function EveryonePlansCalendar({
  group,
  activeDay,
  onSlotOpenDetail,
}: {
  group: FestivalSnapshot;
  activeDay: string;
  onSlotOpenDetail?: (slot: Slot, memberId: string) => void;
}) {
  const dayKey = activeDay.trim();

  const { minMR, maxMR, ticksRender, timelineBodyPx, timelineHRender } =
    useMemo(() => {
      const rows = group.schedule.filter((s) => s.dayLabel.trim() === dayKey);
      if (!rows.length) {
        return {
          minMR: 0,
          maxMR: 60,
          ticksRender: [] as number[],
          timelineBodyPx: 120,
          timelineHRender: 120,
        };
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
      const t: number[] = [];
      for (let m = minM; m <= maxM; m += 30) t.push(m);
      const bodyPx = t.length * pxPerSlot;
      return {
        minMR: minM,
        maxMR: maxM,
        ticksRender: t,
        timelineBodyPx: bodyPx,
        timelineHRender: Math.max(t.length * pxPerSlot, 120),
      };
    }, [group.schedule, dayKey]);

  const members = group.members;

  if (!ticksRender.length) {
    return <p className="text-sm text-zinc-600">No schedule for this day.</p>;
  }

  const range = maxMR - minMR;

  return (
    <div className="max-h-[min(72vh,calc(100vh-10rem))] overflow-auto border-2 border-zinc-900 bg-white">
      <div className="flex min-w-max">
        <div
          className="sticky left-0 z-30 flex shrink-0 flex-col border-r-2 border-zinc-900 bg-zinc-50 shadow-[6px_0_12px_-4px_rgba(0,0,0,0.12)]"
          style={{ width: 56, minHeight: timelineHRender }}
        >
          <div className="sticky top-0 z-40 h-8 shrink-0 border-b-2 border-zinc-900 bg-zinc-50" />
          {ticksRender.map((m) => (
            <div
              key={m}
              className="flex shrink-0 items-start border-b border-zinc-200 px-1 pt-0.5 font-mono text-[10px] text-zinc-600"
              style={{ height: pxPerSlot }}
            >
              {hhmmFromMinutes(m)}
            </div>
          ))}
        </div>

        {members.map((mem) => {
          const slots = group.schedule
            .filter(
              (s) =>
                s.dayLabel.trim() === dayKey &&
                effectiveMemberWantsSlot(group, mem.id, s.id)
            )
            .sort(
              (a, b) =>
                effectiveWindowMinutes(group, mem.id, a).start -
                effectiveWindowMinutes(group, mem.id, b).start
            );

          return (
            <div
              key={mem.id}
              className="relative min-w-[132px] flex-1 border-r-2 border-zinc-900 last:border-r-0"
              style={{ minHeight: timelineHRender }}
            >
              <div className="sticky top-0 z-20 h-8 border-b-2 border-zinc-900 bg-zinc-100 px-1 text-center text-[11px] font-semibold leading-8 text-zinc-900 shadow-[0_6px_10px_-4px_rgba(0,0,0,0.1)]">
                <span className="line-clamp-2">{mem.displayName}</span>
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
                {slots.map((slot, slotIndex) => {
                  const { start: sm, end: em } = effectiveWindowMinutes(
                    group,
                    mem.id,
                    slot
                  );
                  if (range <= 0 || Number.isNaN(sm) || Number.isNaN(em)) {
                    return null;
                  }
                  const topPx = ((sm - minMR) / range) * timelineBodyPx;
                  const heightPx = Math.max(
                    ((em - sm) / range) * timelineBodyPx,
                    22
                  );
                  const open = Boolean(onSlotOpenDetail);
                  return (
                    <div
                      key={slot.id}
                      role={open ? "button" : undefined}
                      tabIndex={open ? 0 : undefined}
                      onClick={
                        open
                          ? () => onSlotOpenDetail?.(slot, mem.id)
                          : undefined
                      }
                      onKeyDown={
                        open
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onSlotOpenDetail?.(slot, mem.id);
                              }
                            }
                          : undefined
                      }
                      className={`absolute left-0.5 right-0.5 flex min-h-0 flex-col overflow-hidden border-2 border-zinc-900 bg-zinc-50 px-1 py-0.5 text-left ${
                        open ? "cursor-pointer hover:bg-zinc-100" : ""
                      }`}
                      style={{
                        top: topPx,
                        height: heightPx,
                        zIndex: 8 + slotIndex,
                      }}
                      title={`${slot.artistName} · ${slot.stageName} · ${slot.start}–${slot.end}`}
                    >
                      <p className="shrink-0 break-words text-[10px] font-semibold leading-tight text-zinc-900 [overflow-wrap:anywhere]">
                        {slot.artistName}
                      </p>
                      <p className="shrink-0 text-[9px] font-medium text-zinc-600">
                        {slot.stageName}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
