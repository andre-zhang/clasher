import type { Prisma, PrismaClient } from "@prisma/client";

import type { FestivalSnapshot } from "@/lib/types";

function parseCustomWindows(
  raw: Prisma.JsonValue | null
): { slotId: string; planFrom: string; planTo: string }[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const out: { slotId: string; planFrom: string; planTo: string }[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") return null;
    const o = x as Record<string, unknown>;
    if (typeof o.slotId !== "string") return null;
    if (typeof o.planFrom !== "string" || typeof o.planTo !== "string")
      return null;
    out.push({
      slotId: o.slotId,
      planFrom: o.planFrom,
      planTo: o.planTo,
    });
  }
  return out.length ? out : null;
}

export async function buildSnapshot(
  db: PrismaClient,
  squadId: string,
  viewingMemberId: string
): Promise<FestivalSnapshot> {
  const squad = await db.squad.findUniqueOrThrow({
    where: { id: squadId },
    include: {
      members: { orderBy: { createdAt: "asc" } },
      artists: { orderBy: { sortOrder: "asc" } },
      scheduleSlots: {
        orderBy: [{ dayLabel: "asc" }, { start: "asc" }],
        include: { artist: true },
      },
    },
  });

  const [ratings, comments, slotComments, conflicts, intents, allIntents, squadDefaults] =
    await Promise.all([
      db.rating.findMany({
        where: { member: { squadId } },
      }),
      db.comment.findMany({
        where: { squadId },
        orderBy: { createdAt: "desc" },
      }),
      db.slotComment.findMany({
        where: { squadId },
        orderBy: { createdAt: "desc" },
      }),
      db.conflictResolution.findMany({
        where: { squadId },
      }),
      db.memberSlotIntent.findMany({
        where: { squadId, memberId: viewingMemberId },
      }),
      db.memberSlotIntent.findMany({
        where: { squadId },
      }),
      db.squadClashDefault.findMany({
        where: { squadId },
      }),
    ]);

  return {
    id: squad.id,
    festivalName: squad.festivalName,
    inviteToken: squad.inviteToken,
    phase: squad.phase,
    festivalDate: squad.festivalDate
      ? squad.festivalDate.toISOString().slice(0, 10)
      : null,
    members: squad.members.map((m) => ({
      id: m.id,
      displayName: m.displayName,
    })),
    artists: squad.artists.map((a) => ({
      id: a.id,
      name: a.name,
      sortOrder: a.sortOrder,
    })),
    ratings: ratings.map((r) => ({
      memberId: r.memberId,
      artistId: r.artistId,
      tier: r.tier,
    })),
    comments: comments.map((c) => ({
      id: c.id,
      artistId: c.artistId,
      memberId: c.memberId,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
    slotComments: slotComments.map((c) => ({
      id: c.id,
      slotId: c.slotId,
      memberId: c.memberId,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
    schedule: squad.scheduleSlots.map((s) => ({
      id: s.id,
      dayLabel: s.dayLabel,
      stageName: s.stageName,
      start: s.start,
      end: s.end,
      artistId: s.artistId,
      artistName: s.artist.name,
    })),
    conflictResolutions: conflicts.map((c) => ({
      memberId: c.memberId,
      slotAId: c.slotAId,
      slotBId: c.slotBId,
      choice: c.choice,
      planNote: c.planNote,
      individualOnly: c.individualOnly,
      planMode: c.planMode ?? null,
      splitFirstSlotId: c.splitFirstSlotId ?? null,
      splitSecondSlotId: c.splitSecondSlotId ?? null,
      groupLeanSlotId: c.groupLeanSlotId ?? null,
    })),
    memberSlotIntents: intents.map((i) => ({
      slotId: i.slotId,
      wants: i.wants,
      scheduleKeep: i.scheduleKeep ?? false,
      planFrom: i.planFrom,
      planTo: i.planTo,
    })),
    allMemberSlotIntents: allIntents.map((i) => ({
      memberId: i.memberId,
      slotId: i.slotId,
      wants: i.wants,
      scheduleKeep: i.scheduleKeep ?? false,
      planFrom: i.planFrom,
      planTo: i.planTo,
    })),
    squadClashDefaults: squadDefaults.map((d) => ({
      slotAId: d.slotAId,
      slotBId: d.slotBId,
      defaultPlanMode: d.defaultPlanMode ?? "pick",
      choiceSlotId: d.choiceSlotId ?? null,
      splitFirstSlotId: d.splitFirstSlotId ?? null,
      splitSecondSlotId: d.splitSecondSlotId ?? null,
      customWindows: parseCustomWindows(d.customWindows),
      setByMemberId: d.setByMemberId,
    })),
  };
}
