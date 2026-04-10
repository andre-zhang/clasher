import type { FestivalSnapshot } from "@/lib/types";
import { slotsInfeasibleTogether } from "@/lib/walkFeasibility";

function parseHm(s: string): number {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

/**
 * Listing times don't overlap in clock sense, but you still can't do both
 * (need walk gap and there isn't enough time between sets).
 */
export function pairListingConflictWalkOnly(
  group: FestivalSnapshot,
  a: FestivalSnapshot["schedule"][0],
  b: FestivalSnapshot["schedule"][0]
): boolean {
  if (!slotsInfeasibleTogether(group, a, b)) return false;
  return !slotsTimeOverlap(a, b);
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

export function isMyClashResolved(
  r: FestivalSnapshot["conflictResolutions"][0] | undefined
): boolean {
  if (!r) return false;
  if (
    r.planMode === "group" ||
    r.planMode === "pick" ||
    r.planMode === "split_seq" ||
    r.planMode === "custom"
  ) {
    return true;
  }
  if (r.choice != null && r.choice !== "") return true;
  return false;
}

function memberRatesHot(
  group: FestivalSnapshot,
  memberId: string,
  artistId: string
): boolean {
  const t = group.ratings.find(
    (r) => r.memberId === memberId && r.artistId === artistId
  )?.tier;
  return t === "must" || t === "want";
}

/** Overlap matters only if someone rated both artists ❤️/🔥. */
export function pairHasSquadInterest(
  group: FestivalSnapshot,
  a: FestivalSnapshot["schedule"][0],
  b: FestivalSnapshot["schedule"][0]
): boolean {
  for (const m of group.members) {
    if (
      memberRatesHot(group, m.id, a.artistId) &&
      memberRatesHot(group, m.id, b.artistId)
    ) {
      return true;
    }
  }
  return false;
}

function findAttendabilityConflictPairs(
  group: FestivalSnapshot
): SlotPair[] {
  const schedule = group.schedule;
  const pairs: SlotPair[] = [];
  for (let i = 0; i < schedule.length; i++) {
    for (let j = i + 1; j < schedule.length; j++) {
      const a = schedule[i]!;
      const b = schedule[j]!;
      if (slotsInfeasibleTogether(group, a, b)) pairs.push({ a, b });
    }
  }
  return pairs;
}

export function findEngagedOverlappingPairs(
  group: FestivalSnapshot
): SlotPair[] {
  return findAttendabilityConflictPairs(group).filter(({ a, b }) =>
    pairHasSquadInterest(group, a, b)
  );
}

export function findUnresolvedOverlappingPairs(
  group: FestivalSnapshot,
  memberId: string
): SlotPair[] {
  const pairs = findEngagedOverlappingPairs(group);
  return pairs.filter(({ a, b }) => {
    const r = findMyResolution(group, memberId, a.id, b.id);
    return !isMyClashResolved(r);
  });
}

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

export function describeConflictResolution(
  c: FestivalSnapshot["conflictResolutions"][0],
  a: FestivalSnapshot["schedule"][0],
  b: FestivalSnapshot["schedule"][0]
): string {
  if (c.planMode === "group") {
    if (c.groupLeanSlotId === a.id) {
      return `with group · lean ${a.artistName}`;
    }
    if (c.groupLeanSlotId === b.id) {
      return `with group · lean ${b.artistName}`;
    }
    return "with group";
  }
  if (c.planMode === "pick" && c.choice) {
    if (c.choice === a.id) return a.artistName;
    if (c.choice === b.id) return b.artistName;
  }
  if (c.choice === a.id) return a.artistName;
  if (c.choice === b.id) return b.artistName;
  if (c.planMode === "split_seq") {
    const n = (id: string) =>
      id === a.id ? a.artistName : id === b.id ? b.artistName : "?";
    if (c.splitFirstSlotId && c.splitSecondSlotId) {
      return `${n(c.splitFirstSlotId)} → ${n(c.splitSecondSlotId)}`;
    }
  }
  if (c.planMode === "custom") return "custom";
  if (c.individualOnly && !c.choice && !c.planMode) return "solo / undecided";
  return "—";
}
