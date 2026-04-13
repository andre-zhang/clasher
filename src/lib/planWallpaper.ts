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

/** Soft color blocks, readable, not neon. */
const STAGE_BG = [
  "rgba(129,140,248,0.45)",
  "rgba(244,114,182,0.34)",
  "rgba(45,212,191,0.4)",
  "rgba(251,191,36,0.32)",
  "rgba(96,165,250,0.42)",
  "rgba(196,181,253,0.4)",
  "rgba(52,211,153,0.36)",
  "rgba(251,146,60,0.3)",
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
      ? `${win.planFrom}-${win.planTo}`
      : `${slot.start}-${slot.end}`;
  return {
    dayLabel: slot.dayLabel.trim(),
    time,
    act: slot.artistName,
    stage: slot.stageName.trim(),
  };
}

/** Slots at least one member keeps on their effective plan (combined “everyone” view). */
export function buildEveryonePlanLines(
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
      time: `${s.start}-${s.end}`,
      act: s.artistName,
      stage: s.stageName.trim(),
    }));
}

/** @deprecated Use buildEveryonePlanLines */
export const buildGroupUnionLines = buildEveryonePlanLines;

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

export function buildEveryoneCalendarSlotsForDay(
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

/** @deprecated Use buildEveryoneCalendarSlotsForDay */
export const buildUnionCalendarSlotsForDay = buildEveryoneCalendarSlotsForDay;

const ACT_FONT_FAMILY =
  "700 {px}px system-ui, -apple-system, Segoe UI, sans-serif";
const STAGE_FONT_FAMILY =
  "600 {px}px system-ui, -apple-system, Segoe UI, sans-serif";

function lineHeightPx(fontPx: number): number {
  return fontPx * 1.15;
}

type SlotBox = { y0: number; h: number; w: number; x: number };

/**
 * One shared act/stage size (as large as possible for all slots), then per-slot
 * shrink only when width still overflows at that size.
 */
function planBlockFonts(
  ctx: CanvasRenderingContext2D,
  slots: PlanCalendarSlot[],
  boxes: SlotBox[],
  innerPad: number,
  minAct: number,
  maxAct: number
): { act: number[]; stage: number[] } {
  const n = slots.length;
  const act: number[] = new Array(n);
  const stage: number[] = new Array(n);
  const gap = 4;

  let lo = minAct;
  let hi = maxAct;
  let uniformAct = minAct;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const st = Math.max(8, Math.round(mid * 0.52));
    let ok = true;
    for (let i = 0; i < n; i++) {
      const s = slots[i]!;
      const b = boxes[i]!;
      const maxTextW = b.w - innerPad * 2;
      const stackH =
        innerPad * 2 +
        lineHeightPx(mid) +
        gap +
        lineHeightPx(st);
      if (stackH > b.h || maxTextW <= 0) {
        ok = false;
        break;
      }
      ctx.font = ACT_FONT_FAMILY.replace("{px}", String(mid));
      if (ctx.measureText(s.act).width > maxTextW) {
        ok = false;
        break;
      }
      ctx.font = STAGE_FONT_FAMILY.replace("{px}", String(st));
      if (ctx.measureText(s.stage).width > maxTextW) {
        ok = false;
        break;
      }
    }
    if (ok) {
      uniformAct = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const uniformStage = Math.max(8, Math.round(uniformAct * 0.52));
  for (let i = 0; i < n; i++) {
    const s = slots[i]!;
    const b = boxes[i]!;
    const maxTextW = Math.max(4, b.w - innerPad * 2);
    let a = uniformAct;
    let st = uniformStage;
    const fits = (): boolean => {
      const stackH =
        innerPad * 2 + lineHeightPx(a) + gap + lineHeightPx(st);
      if (stackH > b.h) return false;
      ctx.font = ACT_FONT_FAMILY.replace("{px}", String(a));
      if (ctx.measureText(s.act).width > maxTextW) return false;
      ctx.font = STAGE_FONT_FAMILY.replace("{px}", String(st));
      if (ctx.measureText(s.stage).width > maxTextW) return false;
      return true;
    };
    while (!fits() && a > minAct) {
      a -= 1;
      st = Math.max(8, Math.round(a * 0.52));
    }
    act[i] = a;
    stage[i] = st;
  }
  return { act, stage };
}

/** Portrait 9:16; top ~1/3 reserved for lock-screen clock, grid below. */
export function renderPlanWallpaperCalendarPng(
  dayLabel: string,
  title: string,
  slots: PlanCalendarSlot[]
): Promise<Blob> {
  const W = 1080;
  const H = 1920;
  const pad = 24;
  const lockReserveY = Math.floor(H / 3);
  const headerBlock = 52;
  const titleBlock = 42;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas unsupported"));

  ctx.fillStyle = "#f4f4f5";
  ctx.fillRect(0, 0, W, lockReserveY);

  const lowerGrad = ctx.createLinearGradient(0, lockReserveY, W, H);
  lowerGrad.addColorStop(0, "#faf5ff");
  lowerGrad.addColorStop(0.35, "#ffffff");
  lowerGrad.addColorStop(0.75, "#eef2ff");
  lowerGrad.addColorStop(1, "#e0e7ff");
  ctx.fillStyle = lowerGrad;
  ctx.fillRect(0, lockReserveY, W, H - lockReserveY);

  const splash = ctx.createRadialGradient(
    W * 0.85,
    H * 0.92,
    0,
    W * 0.85,
    H * 0.92,
    W * 0.55
  );
  splash.addColorStop(0, "rgba(99,102,241,0.22)");
  splash.addColorStop(0.45, "rgba(99,102,241,0.06)");
  splash.addColorStop(1, "rgba(99,102,241,0)");
  ctx.fillStyle = splash;
  ctx.fillRect(0, lockReserveY, W, H - lockReserveY);

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

  const headerStartY = lockReserveY + 20;
  ctx.fillStyle = "#312e81";
  ctx.font = "700 32px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText(dayLabel, pad, headerStartY + 30);
  if (title.trim()) {
    ctx.font = "600 20px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillStyle = "#6366f1";
    ctx.fillText(title.trim(), pad, headerStartY + 58);
  }

  const topY = headerStartY + headerBlock;
  const bodyH = H - topY - pad;
  const bodyW = W - pad * 2;
  const gridBottom = topY + bodyH;

  if (!Number.isFinite(contentMin) || !Number.isFinite(contentMax)) {
    ctx.fillStyle = "#475569";
    ctx.font = "600 24px system-ui, sans-serif";
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

  const tickCount = Math.floor((maxM - minM) / stepM) + 1;
  const tickFontPx =
    tickCount > 28 ? 14 : tickCount > 18 ? 17 : tickCount > 12 ? 20 : 24;
  const timeGutter = tickFontPx >= 20 ? 96 : tickFontPx >= 17 ? 88 : 78;
  const gridLeft = pad + timeGutter;
  const gridW = bodyW - timeGutter;

  ctx.fillStyle = "rgba(99,102,241,0.12)";
  ctx.fillRect(gridLeft, topY, gridW, titleBlock - 2);
  ctx.fillStyle = "#334155";
  ctx.font = "700 18px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText("Plan", gridLeft + 8, topY + 26);

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.fillRect(gridLeft, topY + titleBlock, gridW, timelineH);
  ctx.strokeStyle = "rgba(99,102,241,0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(gridLeft, topY + titleBlock, gridW, timelineH);

  for (let m = minM; m <= maxM; m += stepM) {
    const y = topY + titleBlock + (m - minM) * pxPerMin;
    ctx.strokeStyle = "rgba(15,23,42,0.1)";
    ctx.beginPath();
    ctx.moveTo(gridLeft, y);
    ctx.lineTo(W - pad, y);
    ctx.stroke();
    ctx.fillStyle = "#1e293b";
    ctx.font = `600 ${tickFontPx}px ui-monospace, monospace`;
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    const label = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    ctx.fillText(label, pad, y + tickFontPx * 0.35);
  }

  const stageBg = (stage: string) => {
    let h = 0;
    const st = stage.trim();
    for (let i = 0; i < st.length; i++) h = (h * 31 + st.charCodeAt(i)) >>> 0;
    return STAGE_BG[h % STAGE_BG.length]!;
  };

  const innerPad = 10;
  const gap = 4;
  type Placed = { slot: PlanCalendarSlot; y0: number; h: number; x: number; w: number };
  const placed: Placed[] = [];
  for (const s of slots) {
    const ss = parseHmRelaxed(s.start);
    const ee = parseHmRelaxed(s.end);
    if (Number.isNaN(ss) || Number.isNaN(ee)) continue;
    const y0 = topY + titleBlock + (ss - minM) * pxPerMin;
    const y1 = topY + titleBlock + (ee - minM) * pxPerMin;
    const h = Math.max(y1 - y0, 10);
    const x = gridLeft + 2;
    const w = gridW - 4;
    placed.push({ slot: s, y0, h, x, w });
  }

  const boxes: SlotBox[] = placed.map((p) => ({
    y0: p.y0,
    h: p.h,
    w: p.w,
    x: p.x,
  }));
  const slotArr = placed.map((p) => p.slot);
  const { act: actFonts, stage: stageFonts } =
    slotArr.length > 0
      ? planBlockFonts(ctx, slotArr, boxes, innerPad, 10, 52)
      : { act: [], stage: [] };

  const prevBaseline = ctx.textBaseline;
  ctx.textBaseline = "top";

  placed.forEach((p, i) => {
    const s = p.slot;
    const { y0, h, x, w } = p;
    ctx.fillStyle = stageBg(s.stage);
    ctx.globalAlpha = 0.98;
    ctx.fillRect(x, y0, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y0, w, h);

    const actPx = actFonts[i] ?? 12;
    const stPx = stageFonts[i] ?? 8;
    const tx = x + innerPad;
    const ty = y0 + innerPad;

    ctx.fillStyle = "#0f172a";
    ctx.font = ACT_FONT_FAMILY.replace("{px}", String(actPx));
    ctx.fillText(s.act, tx, ty);

    ctx.fillStyle = "#475569";
    ctx.font = STAGE_FONT_FAMILY.replace("{px}", String(stPx));
    ctx.fillText(
      s.stage,
      tx,
      ty + lineHeightPx(actPx) + gap
    );
  });

  ctx.textBaseline = prevBaseline;

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
