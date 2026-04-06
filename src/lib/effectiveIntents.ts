import type { FestivalSnapshot } from "@/lib/types";

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

  const groupRes = group.conflictResolutions.filter(
    (c) =>
      c.memberId === memberId &&
      c.planMode === "group" &&
      (c.slotAId === slotId || c.slotBId === slotId)
  );
  for (const c of groupRes) {
    const def = findSquadClashDefault(group, c.slotAId, c.slotBId);
    if (def) {
      return def.choiceSlotId === slotId;
    }
  }

  return base;
}
