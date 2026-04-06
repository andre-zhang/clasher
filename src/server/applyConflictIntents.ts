import type { PrismaClient } from "@prisma/client";

import { hhmmFromMinutes, parseHm, splitSwitchMinutes } from "@/lib/timeHm";

import { wantsDeltaFromChoice } from "./memberSlotIntentPatch";

type Db = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

async function upsertIntent(
  tx: Db,
  squadId: string,
  memberId: string,
  slotId: string,
  wants: boolean,
  planFrom: string | null,
  planTo: string | null
) {
  await tx.memberSlotIntent.upsert({
    where: { memberId_slotId: { memberId, slotId } },
    create: { squadId, memberId, slotId, wants, planFrom, planTo },
    update: { wants, planFrom, planTo },
  });
}

function clampMinutesToSlot(
  slot: { start: string; end: string },
  m: number
): number {
  const s = parseHm(slot.start);
  const e = parseHm(slot.end);
  if (Number.isNaN(s) || Number.isNaN(e)) return m;
  return Math.min(e, Math.max(s, m));
}

export async function patchIntentsForConflict(
  tx: Db,
  squadId: string,
  memberId: string,
  slotAId: string,
  slotBId: string,
  opts: {
    planMode: string | null;
    choice: string | null;
    splitOrderSlotIds?: [string, string] | null;
    customWindows?: { slotId: string; planFrom: string; planTo: string }[] | null;
  }
): Promise<void> {
  const { planMode, choice, splitOrderSlotIds, customWindows } = opts;

  const effectiveMode =
    planMode ?? (choice != null && choice !== "" ? "pick" : null);

  if (effectiveMode === "group") {
    return;
  }

  if (effectiveMode === "pick" && choice) {
    const delta = wantsDeltaFromChoice(slotAId, slotBId, choice);
    for (const [slotId, wants] of Object.entries(delta)) {
      await upsertIntent(tx, squadId, memberId, slotId, wants, null, null);
    }
    return;
  }

  if (effectiveMode === "split_seq" && splitOrderSlotIds?.length === 2) {
    const [firstId, secondId] = splitOrderSlotIds;
    const ids = new Set([slotAId, slotBId]);
    if (!ids.has(firstId) || !ids.has(secondId) || firstId === secondId) {
      return;
    }
    const slots = await tx.scheduleSlot.findMany({
      where: { squadId, id: { in: [firstId, secondId] } },
    });
    const first = slots.find((s) => s.id === firstId);
    const second = slots.find((s) => s.id === secondId);
    if (!first || !second) return;
    const mid = splitSwitchMinutes(
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
    const mFirst = clampMinutesToSlot(first, mid);
    const mSecond = clampMinutesToSlot(second, mid);
    await upsertIntent(
      tx,
      squadId,
      memberId,
      firstId,
      true,
      first.start,
      hhmmFromMinutes(mFirst)
    );
    await upsertIntent(
      tx,
      squadId,
      memberId,
      secondId,
      true,
      hhmmFromMinutes(mSecond),
      second.end
    );
    return;
  }

  if (effectiveMode === "custom" && customWindows?.length) {
    const pair = new Set([slotAId, slotBId]);
    for (const w of customWindows) {
      if (!pair.has(w.slotId)) continue;
      const from = String(w.planFrom).trim();
      const to = String(w.planTo).trim();
      if (!/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to)) continue;
      await upsertIntent(tx, squadId, memberId, w.slotId, true, from, to);
    }
  }
}
