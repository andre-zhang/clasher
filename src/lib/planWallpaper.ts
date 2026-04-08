import {
  effectiveMemberSlotPlanWindow,
  effectiveMemberWantsSlot,
} from "@/lib/effectiveIntents";
import { parseHm } from "@/lib/timeHm";
import type { FestivalSnapshot } from "@/lib/types";

export type PlanWallpaperLine = {
  dayLabel: string;
  time: string;
  act: string;
  stage: string;
};

function slotSortKey(s: FestivalSnapshot["schedule"][0]): number {
  const d = s.dayLabel.trim().toLowerCase();
  const t = parseHm(s.start);
  let day = 0;
  for (let i = 0; i < d.length; i++) day = day * 31 + d.charCodeAt(i);
  return day * 100000 + (Number.isNaN(t) ? 0 : t);
}

function lineForMemberSlot(
  group: FestivalSnapshot,
  memberId: string,
  slot: FestivalSnapshot["schedule"][0]
): PlanWallpaperLine {
  const win = effectiveMemberSlotPlanWindow(group, memberId, slot);
  const time =
    win.planFrom && win.planTo
      ? `${win.planFrom}–${win.planTo}`
      : `${slot.start}–${slot.end}`;
  return {
    dayLabel: slot.dayLabel.trim(),
    time,
    act: slot.artistName,
    stage: slot.stageName.trim(),
  };
}

/** Slots at least one member keeps on their effective plan (union). */
export function buildGroupUnionLines(
  group: FestivalSnapshot
): PlanWallpaperLine[] {
  const ids = new Set<string>();
  for (const m of group.members) {
    for (const s of group.schedule) {
      if (effectiveMemberWantsSlot(group, m.id, s.id)) ids.add(s.id);
    }
  }
  return [...group.schedule]
    .filter((s) => ids.has(s.id))
    .sort((a, b) => slotSortKey(a) - slotSortKey(b))
    .map((s) => ({
      dayLabel: s.dayLabel.trim(),
      time: `${s.start}–${s.end}`,
      act: s.artistName,
      stage: s.stageName.trim(),
    }));
}

export function buildMemberPlanLines(
  group: FestivalSnapshot,
  memberId: string
): PlanWallpaperLine[] {
  return [...group.schedule]
    .filter((s) => effectiveMemberWantsSlot(group, memberId, s.id))
    .sort((a, b) => slotSortKey(a) - slotSortKey(b))
    .map((s) => lineForMemberSlot(group, memberId, s));
}

/** 16:9 — top third left blank for wallpaper (e.g. clock / photo). */
export function renderPlanWallpaperPng(
  lines: PlanWallpaperLine[],
  title: string
): Promise<Blob> {
  const W = 1920;
  const H = 1080;
  const topThird = H / 3;
  const padX = 72;
  const padY = 48;
  const usableTop = topThird + padY;
  const usableH = H - usableTop - padY;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Promise.reject(new Error("Canvas unsupported"));
  }

  ctx.fillStyle = "#fafafa";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "#18181b";
  ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, W - 24, H - 24);

  ctx.fillStyle = "#18181b";
  ctx.font = "600 36px system-ui, -apple-system, Segoe UI, sans-serif";
  const titleY = usableTop + 32;
  ctx.fillText(title, padX, titleY);

  const lineHeight = Math.min(
    52,
    Math.max(32, Math.floor((usableH - 48) / Math.max(lines.length, 1)))
  );
  ctx.font = `500 ${Math.min(26, lineHeight - 8)}px system-ui, -apple-system, Segoe UI, sans-serif`;

  let y = titleY + 44;
  const maxW = W - padX * 2;

  for (const row of lines) {
    const text = `${row.dayLabel} · ${row.time}: ${row.act}: ${row.stage}`;
    const words = text.split(" ");
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, padX, y);
        y += lineHeight;
        line = w;
      } else {
        line = test;
      }
    }
    if (line) {
      ctx.fillText(line, padX, y);
      y += lineHeight;
    }
    if (y > H - padY) break;
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
      0.92
    );
  });
}
