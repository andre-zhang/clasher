import {
  effectiveMemberSlotPlanWindow,
  effectiveMemberWantsSlot,
} from "@/lib/effectiveIntents";
import { parseHm, wallMinutesToFestivalTimeline } from "@/lib/timeHm";
import { walkMinutesBetweenStages } from "@/lib/walkFeasibility";
import type { FestivalSnapshot } from "@/lib/types";

/** Start/end on the festival timeline (1 PM → … → 12:59 AM). */
export function effectiveWindowMinutes(
  group: FestivalSnapshot,
  memberId: string,
  slot: FestivalSnapshot["schedule"][0]
): { start: number; end: number } {
  const s0w = parseHm(slot.start);
  const e0w = parseHm(slot.end);
  if (Number.isNaN(s0w) || Number.isNaN(e0w)) return { start: 0, end: 0 };
  const s0 = wallMinutesToFestivalTimeline(s0w);
  const e0 = wallMinutesToFestivalTimeline(e0w);
  if (Number.isNaN(s0) || Number.isNaN(e0)) return { start: 0, end: 0 };
  if (!effectiveMemberWantsSlot(group, memberId, slot.id)) {
    return { start: s0, end: s0 };
  }
  const row = group.allMemberSlotIntents.find(
    (i) => i.memberId === memberId && i.slotId === slot.id
  );
  const eff = effectiveMemberSlotPlanWindow(group, memberId, slot);
  const fromS = eff.planFrom ?? row?.planFrom ?? null;
  const toS = eff.planTo ?? row?.planTo ?? null;
  if (!fromS && !toS && (!row || !row.wants)) {
    return { start: s0, end: e0 };
  }
  const fsw = fromS ? parseHm(fromS) : NaN;
  const few = toS ? parseHm(toS) : NaN;
  const fs = Number.isNaN(fsw) ? NaN : wallMinutesToFestivalTimeline(fsw);
  const fe = Number.isNaN(few) ? NaN : wallMinutesToFestivalTimeline(few);
  const ss = Number.isNaN(fs) ? s0 : Math.max(s0, fs);
  const ee = Number.isNaN(fe) ? e0 : Math.min(e0, fe);
  return { start: ss, end: Math.max(ss, ee) };
}

export function planDayTravelLines(
  group: FestivalSnapshot,
  memberId: string,
  dayLabel: string
): string[] {
  const d = dayLabel.trim();
  const slots = group.schedule.filter(
    (s) =>
      s.dayLabel.trim() === d && effectiveMemberWantsSlot(group, memberId, s.id)
  );
  slots.sort(
    (a, b) =>
      effectiveWindowMinutes(group, memberId, a).start -
      effectiveWindowMinutes(group, memberId, b).start
  );
  const out: string[] = [];
  for (let i = 0; i < slots.length - 1; i++) {
    const cur = slots[i]!;
    const nxt = slots[i + 1]!;
    const w = walkMinutesBetweenStages(group, cur.stageName, nxt.stageName);
    if (w <= 0) continue;
    out.push(
      `${cur.artistName} → ${nxt.artistName}: ~${w}m (${cur.stageName} → ${nxt.stageName})`
    );
  }
  return out;
}
