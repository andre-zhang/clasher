import type { PrismaClient } from "@prisma/client";

import { parseHm, splitPriorityWindows } from "@/lib/timeHm";

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
    create: {
      squadId,
      memberId,
      slotId,
      wants,
      planFrom,
      planTo,
      scheduleKeep: false,
    },
    update: { wants, planFrom, planTo },
  });
}

/** Pick winner keeps existing plan windows; loser clears (fixes cross-clash wipes). */
async function upsertIntentPickOutcome(
  tx: Db,
  squadId: string,
  memberId: string,
  slotId: string,
  wants: boolean
) {
  if (!wants) {
    await upsertIntent(tx, squadId, memberId, slotId, false, null, null);
    return;
  }
  const cur = await tx.memberSlotIntent.findUnique({
    where: { memberId_slotId: { memberId, slotId } },
  });
  await upsertIntent(
    tx,
    squadId,
    memberId,
    slotId,
    true,
    cur?.planFrom ?? null,
    cur?.planTo ?? null
  );
}

export async function applyPickChoiceToIntents(
  tx: Db,
  squadId: string,
  memberId: string,
  slotAId: string,
  slotBId: string,
  choice: string
): Promise<void> {
  const delta = wantsDeltaFromChoice(slotAId, slotBId, choice);
  for (const [slotId, wants] of Object.entries(delta)) {
    await upsertIntentPickOutcome(tx, squadId, memberId, slotId, wants);
  }
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
    await applyPickChoiceToIntents(
      tx,
      squadId,
      memberId,
      slotAId,
      slotBId,
      choice
    );
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
    const f0 = parseHm(wins.first.from);
    const f1 = parseHm(wins.first.to);
    const s0 = parseHm(wins.second.from);
    const s1 = parseHm(wins.second.to);
    const firstOk = !Number.isNaN(f0) && !Number.isNaN(f1) && f0 < f1;
    const secondOk = !Number.isNaN(s0) && !Number.isNaN(s1) && s0 < s1;
    await upsertIntent(
      tx,
      squadId,
      memberId,
      firstId,
      firstOk,
      firstOk ? wins.first.from : first.start,
      firstOk ? wins.first.to : first.end
    );
    await upsertIntent(
      tx,
      squadId,
      memberId,
      secondId,
      secondOk,
      secondOk ? wins.second.from : second.start,
      secondOk ? wins.second.to : second.end
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
