import {
  effectiveMemberSlotPlanWindow,
  effectiveMemberWantsSlot,
} from "@/lib/effectiveIntents";
import { parseHm, parseHmRelaxed } from "@/lib/timeHm";
import type { FestivalSnapshot } from "@/lib/types";

export type PlanWallpaperLine = {
  dayLabel: string;
  time: string;
  act: string;
  stage: string;
};

export type PlanCalendarSlot = {
  start: string;
  end: string;
  act: string;
  stage: string;
};

const STAGE_BG = [
  "#c7d2fe",
  "#fde68a",
  "#86efac",
  "#fbcfe8",
  "#a5f3fc",
  "#fcd34d",
  "#bfdbfe",
  "#d8b4fe",
];

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

export function buildMemberPlanCalendarSlotsForDay(
  group: FestivalSnapshot,
  memberId: string,
  dayLabel: string
): PlanCalendarSlot[] {
  const d = dayLabel.trim();
  return group.schedule
    .filter(
      (s) =>
        s.dayLabel.trim() === d &&
        effectiveMemberWantsSlot(group, memberId, s.id)
    )
    .map((s) => {
      const w = effectiveMemberSlotPlanWindow(group, memberId, s);
      return {
        start: w.planFrom ?? s.start,
        end: w.planTo ?? s.end,
        act: s.artistName,
        stage: s.stageName.trim(),
      };
    })
    .sort((a, b) => parseHmRelaxed(a.start) - parseHmRelaxed(b.start));
}

export function buildUnionCalendarSlotsForDay(
  group: FestivalSnapshot,
  dayLabel: string
): PlanCalendarSlot[] {
  const ids = new Set<string>();
  for (const m of group.members) {
    for (const s of group.schedule) {
      if (effectiveMemberWantsSlot(group, m.id, s.id)) ids.add(s.id);
    }
  }
  const d = dayLabel.trim();
  return group.schedule
    .filter((s) => s.dayLabel.trim() === d && ids.has(s.id))
    .map((s) => ({
      start: s.start,
      end: s.end,
      act: s.artistName,
      stage: s.stageName.trim(),
    }))
    .sort((a, b) => parseHmRelaxed(a.start) - parseHmRelaxed(b.start));
}

function maxFontForText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxH: number,
  minPx: number,
  maxPx: number
): number {
  if (!text.trim()) return minPx;
  let lo = minPx;
  let hi = maxPx;
  let best = minPx;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    ctx.font = `700 ${mid}px system-ui, -apple-system, Segoe UI, sans-serif`;
    const m = ctx.measureText(text);
    const w = m.width;
    const h = mid * 1.15;
    if (w <= maxW && h <= maxH) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** Portrait 9:16 — zoomed to when you have sets; tuned for lock-screen glance. */
export function renderPlanWallpaperCalendarPng(
  dayLabel: string,
  title: string,
  slots: PlanCalendarSlot[]
): Promise<Blob> {
  const W = 1080;
  const H = 1920;
  const pad = 20;
  const timeGutter = 64;
  const headerH = 80;
  const titleBlock = 52;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas unsupported"));

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#1e1b4b");
  grad.addColorStop(0.45, "#312e81");
  grad.addColorStop(1, "#4c1d95");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#faf5ff";
  ctx.font = "700 32px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText(title, pad, pad + 28);

  ctx.font = "600 24px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillStyle = "#e9d5ff";
  ctx.fillText(dayLabel, pad, pad + 58);

  const stages = [...new Set(slots.map((s) => s.stage.trim()))].sort();
  const topY = pad + headerH;
  const bodyH = H - topY - pad;
  const bodyW = W - pad * 2;
  const gridLeft = pad + timeGutter;
  const gridW = bodyW - timeGutter;
  const colW = stages.length ? gridW / stages.length : gridW;
  const gridBottom = topY + bodyH;

  let contentMin = Infinity;
  let contentMax = -Infinity;
  for (const s of slots) {
    const a = parseHmRelaxed(s.start);
    const b = parseHmRelaxed(s.end);
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      contentMin = Math.min(contentMin, a);
      contentMax = Math.max(contentMax, b);
    }
  }

  if (!Number.isFinite(contentMin) || !Number.isFinite(contentMax)) {
    ctx.fillStyle = "#fce7f3";
    ctx.font = "600 22px system-ui, sans-serif";
    ctx.fillText("Nothing planned this day", pad, topY + 80);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/png",
        0.92
      );
    });
  }

  const bufferMin = 15;
  let minM = contentMin - bufferMin;
  let maxM = contentMax + bufferMin;
  const minSpan = 100;
  if (maxM - minM < minSpan) {
    const mid = (minM + maxM) / 2;
    minM = mid - minSpan / 2;
    maxM = mid + minSpan / 2;
  }
  minM = Math.max(0, minM);
  maxM = Math.min(24 * 60 + 120, maxM);

  const stepM = maxM - minM > 240 ? 60 : maxM - minM > 90 ? 30 : 15;
  minM = Math.floor(minM / stepM) * stepM;
  maxM = Math.ceil(maxM / stepM) * stepM;
  const range = Math.max(stepM, maxM - minM);
  const timelineH = gridBottom - (topY + titleBlock);
  const pxPerMin = timelineH / range;

  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(gridLeft, topY + titleBlock, gridW, timelineH);

  stages.forEach((st, i) => {
    const x = gridLeft + i * colW;
    ctx.fillStyle = STAGE_BG[i % STAGE_BG.length]!;
    ctx.fillRect(x, topY, colW, titleBlock - 2);
    ctx.fillStyle = "#1e1b4b";
    ctx.font = "700 15px system-ui, -apple-system, Segoe UI, sans-serif";
    const label = st.length > 16 ? `${st.slice(0, 14)}…` : st;
    ctx.fillText(label, x + 4, topY + 24);
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + colW, topY);
    ctx.lineTo(x + colW, gridBottom);
    ctx.stroke();
  });

  for (let m = minM; m <= maxM; m += stepM) {
    const y = topY + titleBlock + (m - minM) * pxPerMin;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(gridLeft, y);
    ctx.lineTo(W - pad, y);
    ctx.stroke();
    ctx.fillStyle = "#fae8ff";
    ctx.font = "600 13px ui-monospace, monospace";
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    const label = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    ctx.fillText(label, pad, y + 5);
  }

  const stageIndex = new Map(stages.map((s, i) => [s, i]));

  for (const s of slots) {
    const si = stageIndex.get(s.stage.trim());
    if (si === undefined) continue;
    const ss = parseHmRelaxed(s.start);
    const ee = parseHmRelaxed(s.end);
    if (Number.isNaN(ss) || Number.isNaN(ee)) continue;
    const y0 = topY + titleBlock + (ss - minM) * pxPerMin;
    const y1 = topY + titleBlock + (ee - minM) * pxPerMin;
    const h = Math.max(y1 - y0, 10);
    const x = gridLeft + si * colW + 2;
    const w = colW - 4;

    ctx.fillStyle = STAGE_BG[si % STAGE_BG.length]!;
    ctx.globalAlpha = 0.98;
    ctx.fillRect(x, y0, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y0, w, h);

    const innerPad = 8;
    const maxTextW = w - innerPad * 2;
    const maxTextH = Math.max(18, h - innerPad * 2 - 18);
    const timeStr = `${s.start}–${s.end}`;
    const fp = maxFontForText(ctx, s.act, maxTextW, maxTextH, 11, 30);
    ctx.fillStyle = "#0f172a";
    ctx.font = `700 ${fp}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.fillText(s.act, x + innerPad, y0 + innerPad + fp);

    ctx.font = `600 ${Math.min(14, Math.max(10, fp - 4))}px ui-monospace, monospace`;
    ctx.fillStyle = "#1e293b";
    ctx.fillText(timeStr, x + innerPad, y0 + h - 6);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
      0.92
    );
  });
}

/** @deprecated list-style export; prefer renderPlanWallpaperCalendarPng */
export function renderPlanWallpaperPng(
  lines: PlanWallpaperLine[],
  title: string
): Promise<Blob> {
  const day = lines[0]?.dayLabel ?? "Day";
  const slots: PlanCalendarSlot[] = lines.map((row) => {
    const parts = row.time.split(/[–-]/);
    return {
      start: (parts[0] ?? "").trim(),
      end: (parts[1] ?? "").trim(),
      act: row.act,
      stage: row.stage,
    };
  });
  return renderPlanWallpaperCalendarPng(day, title, slots);
}
