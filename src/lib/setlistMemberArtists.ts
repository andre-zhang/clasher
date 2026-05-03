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
    const deduped = [
      ...new Set(
        body.artistIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];
    const allowed = await prisma.artist.findMany({
      where: { squadId: member.squadId, id: { in: deduped } },
      select: { id: true },
    });
    const idOk = new Set(allowed.map((a) => a.id));
    artistIds = deduped.filter((id) => idOk.has(id)).slice(0, 30);
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

  const rows = await prisma.artist.findMany({
    where: { id: { in: artistIds }, squadId: member.squadId },
    select: { id: true, name: true },
  });
  const byId = new Map(rows.map((a) => [a.id, a]));
  const artists = artistIds
    .map((id) => byId.get(id))
    .filter((a): a is { id: string; name: string } => Boolean(a));

  return { ok: true, artists };
}
