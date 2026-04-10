import type { FestivalSnapshot } from "@/lib/types";
import { splitPriorityWindows } from "@/lib/timeHm";

function normPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

export function findSquadClashDefault(
  group: FestivalSnapshot,
  slotAId: string,
  slotBId: string
) {
  const [x, y] = normPair(slotAId, slotBId);
  return group.squadClashDefaults.find(
    (d) => d.slotAId === x && d.slotBId === y
  );
}

function splitWindowsForPair(
  schedule: FestivalSnapshot["schedule"],
  slotAId: string,
  slotBId: string,
  firstId: string,
  secondId: string
): Record<string, { planFrom: string; planTo: string }> {
  const out: Record<string, { planFrom: string; planTo: string }> = {};
  const first = schedule.find((s) => s.id === firstId);
  const second = schedule.find((s) => s.id === secondId);
  if (!first || !second) return out;
  const ids = new Set([slotAId, slotBId]);
  if (!ids.has(firstId) || !ids.has(secondId) || firstId === secondId)
    return out;
  const wins = splitPriorityWindows(
    {
      dayLabel: first.dayLabel,
      start: first.start,
      end: first.end,
    },
    {
      dayLabel: second.dayLabel,
      start: second.start,
      end: second.end,
    }
  );
  out[firstId] = { planFrom: wins.first.from, planTo: wins.first.to };
  out[secondId] = { planFrom: wins.second.from, planTo: wins.second.to };
  return out;
}

/**
 * Plan window for a slot after personal or squad clash resolution.
 */
export function effectiveMemberSlotPlanWindow(
  group: FestivalSnapshot,
  memberId: string,
  slot: FestivalSnapshot["schedule"][0]
): { planFrom: string | null; planTo: string | null } {
  const row = group.allMemberSlotIntents.find(
    (i) => i.memberId === memberId && i.slotId === slot.id
  );

  const personalSplit = group.conflictResolutions.filter(
    (c) =>
      c.memberId === memberId &&
      c.planMode === "split_seq" &&
      c.splitFirstSlotId &&
      c.splitSecondSlotId &&
      (c.slotAId === slot.id || c.slotBId === slot.id)
  );
  for (const c of personalSplit) {
    const wins = splitWindowsForPair(
      group.schedule,
      c.slotAId,
      c.slotBId,
      c.splitFirstSlotId!,
      c.splitSecondSlotId!
    );
    const w = wins[slot.id];
    if (w) return { planFrom: w.planFrom, planTo: w.planTo };
  }

  const groupRes = group.conflictResolutions.filter(
    (c) =>
      c.memberId === memberId &&
      c.planMode === "group" &&
      (c.slotAId === slot.id || c.slotBId === slot.id)
  );

  for (const c of groupRes) {
    const def = findSquadClashDefault(group, c.slotAId, c.slotBId);
    if (!def) continue;
    const mode = def.defaultPlanMode ?? "pick";
    if (mode === "split_seq" && def.splitFirstSlotId && def.splitSecondSlotId) {
      const wins = splitWindowsForPair(
        group.schedule,
        c.slotAId,
        c.slotBId,
        def.splitFirstSlotId,
        def.splitSecondSlotId
      );
      const w = wins[slot.id];
      if (w) return { planFrom: w.planFrom, planTo: w.planTo };
    }
    if (mode === "custom" && def.customWindows?.length) {
      const w = def.customWindows.find((x) => x.slotId === slot.id);
      if (w) return { planFrom: w.planFrom, planTo: w.planTo };
    }
  }

  return {
    planFrom: row?.planFrom ?? null,
    planTo: row?.planTo ?? null,
  };
}

/**
 * Wants for a slot after applying “stay with group” + squad default override.
 */
export function effectiveMemberWantsSlot(
  group: FestivalSnapshot,
  memberId: string,
  slotId: string
): boolean {
  const row = group.allMemberSlotIntents.find(
    (i) => i.memberId === memberId && i.slotId === slotId
  );
  const base = row ? row.wants : true;

  // Intent row is authoritative after pick resolutions (server updates it).
  // Inferring from the first matching pick row broke when one slot was in multiple pairs.
  if (row === undefined) {
    for (const c of group.conflictResolutions) {
      if (c.memberId !== memberId) continue;
      if (c.planMode === "group") continue;
      if (c.planMode === "split_seq" || c.planMode === "custom") continue;
      if (!c.choice) continue;
      if (c.slotAId !== slotId && c.slotBId !== slotId) continue;
      return c.choice === slotId;
    }
  }

  const groupRes = group.conflictResolutions.filter(
    (c) =>
      c.memberId === memberId &&
      c.planMode === "group" &&
      (c.slotAId === slotId || c.slotBId === slotId)
  );
  for (const c of groupRes) {
    const def = findSquadClashDefault(group, c.slotAId, c.slotBId);
    if (!def) continue;
    const mode = def.defaultPlanMode ?? "pick";
    if (mode === "pick") {
      if (def.choiceSlotId) {
        return def.choiceSlotId === slotId;
      }
      continue;
    }
    if (mode === "split_seq" || mode === "custom") {
      if (slotId === c.slotAId || slotId === c.slotBId) return true;
    }
  }

  return base;
}
