import { prisma } from "@/lib/prisma";

/**
 * Same artist selection as setlist/preview: explicit ids or must/want + plan wants.
 */
export async function getArtistsForMemberSetlist(
  member: { id: string; squadId: string },
  body: { artistIds?: string[] }
): Promise<
  | { ok: false; error: "too_many_artists" }
  | { ok: true; artists: { id: string; name: string }[] }
> {
  let artistIds: string[] = [];
  if (Array.isArray(body.artistIds) && body.artistIds.length) {
    const allowed = await prisma.artist.findMany({
      where: { squadId: member.squadId, id: { in: body.artistIds } },
      select: { id: true },
    });
    artistIds = allowed.map((a) => a.id);
  } else {
    const fromRatings = await prisma.rating.findMany({
      where: {
        memberId: member.id,
        /** Everyone you didn’t skip: must, want, maybe. “Skip” means not in the personal set. */
        tier: { in: ["must", "want", "maybe"] },
        artist: { squadId: member.squadId },
      },
      select: { artistId: true },
    });
    const fromPlan = await prisma.memberSlotIntent.findMany({
      where: {
        memberId: member.id,
        wants: true,
        squadId: member.squadId,
      },
      select: { slotId: true },
    });
    const planSlots = await prisma.scheduleSlot.findMany({
      where: {
        squadId: member.squadId,
        id: { in: fromPlan.map((p) => p.slotId) },
      },
      select: { artistId: true },
    });
    const s = new Set<string>();
    for (const r of fromRatings) s.add(r.artistId);
    for (const p of planSlots) s.add(p.artistId);
    artistIds = [...s];
  }

  if (artistIds.length > 30) {
    return { ok: false, error: "too_many_artists" };
  }

  const artists = await prisma.artist.findMany({
    where: { id: { in: artistIds }, squadId: member.squadId },
    select: { id: true, name: true },
  });

  return { ok: true, artists };
}
