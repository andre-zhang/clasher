import {
  effectiveMemberSlotPlanWindow,
  effectiveMemberWantsSlot,
} from "@/lib/effectiveIntents";
import { parseHm } from "@/lib/timeHm";
import { walkMinutesBetweenStages } from "@/lib/walkFeasibility";
import type { FestivalSnapshot } from "@/lib/types";

export function effectiveWindowMinutes(
  group: FestivalSnapshot,
  memberId: string,
  slot: FestivalSnapshot["schedule"][0]
): { start: number; end: number } {
  const s0 = parseHm(slot.start);
  const e0 = parseHm(slot.end);
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
  const fs = fromS ? parseHm(fromS) : s0;
  const fe = toS ? parseHm(toS) : e0;
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
    const w = group.walkTimesEnabled
      ? walkMinutesBetweenStages(group, cur.stageName, nxt.stageName)
      : 0;
    if (w <= 0) continue;
    out.push(
      `${cur.artistName} → ${nxt.artistName}: ~${w}m (${cur.stageName} → ${nxt.stageName})`
    );
  }
  return out;
}
