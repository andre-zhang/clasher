import type { FestivalSnapshot } from "@/lib/types";

function parseHm(s: string): number {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

export function slotsTimeOverlap(
  a: { dayLabel: string; start: string; end: string },
  b: { dayLabel: string; start: string; end: string }
): boolean {
  if (a.dayLabel.trim().toLowerCase() !== b.dayLabel.trim().toLowerCase())
    return false;
  const as = parseHm(a.start);
  const ae = parseHm(a.end);
  const bs = parseHm(b.start);
  const be = parseHm(b.end);
  if ([as, ae, bs, be].some(Number.isNaN)) return false;
  return as < be && bs < ae;
}

export type SlotPair = { a: FestivalSnapshot["schedule"][0]; b: FestivalSnapshot["schedule"][0] };

export function findOverlappingPairs(
  schedule: FestivalSnapshot["schedule"]
): SlotPair[] {
  const pairs: SlotPair[] = [];
  for (let i = 0; i < schedule.length; i++) {
    for (let j = i + 1; j < schedule.length; j++) {
      const a = schedule[i]!;
      const b = schedule[j]!;
      if (slotsTimeOverlap(a, b)) {
        pairs.push({ a, b });
      }
    }
  }
  return pairs;
}

export function pairKey(idA: string, idB: string): string {
  return idA <= idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

export function findMyResolution(
  group: FestivalSnapshot,
  myMemberId: string,
  slotAId: string,
  slotBId: string
) {
  const [x, y] = slotAId <= slotBId ? [slotAId, slotBId] : [slotBId, slotAId];
  return group.conflictResolutions.find(
    (c) =>
      c.memberId === myMemberId &&
      c.slotAId === x &&
      c.slotBId === y
  );
}
