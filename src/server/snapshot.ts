import type { PrismaClient } from "@prisma/client";

import type { FestivalSnapshot } from "@/lib/types";

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

  const [ratings, comments, conflicts, intents] = await Promise.all([
    db.rating.findMany({
      where: { member: { squadId } },
    }),
    db.comment.findMany({
      where: { squadId },
      orderBy: { createdAt: "desc" },
    }),
    db.conflictResolution.findMany({
      where: { squadId },
    }),
    db.memberSlotIntent.findMany({
      where: { squadId, memberId: viewingMemberId },
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
    })),
    memberSlotIntents: intents.map((i) => ({
      slotId: i.slotId,
      wants: i.wants,
      planFrom: i.planFrom,
      planTo: i.planTo,
    })),
  };
}
