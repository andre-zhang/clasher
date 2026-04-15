import {
  effectiveMemberSlotPlanWindow,
  effectiveMemberWantsSlot,
  memberContributesToGroupPlan,
} from "@/lib/effectiveIntents";
import {
  formatFestivalTickHm,
  parseHmRelaxed,
  wallMinutesToFestivalTimeline,
} from "@/lib/timeHm";
import type { PlanWalkBand } from "@/lib/planWalkBands";
import type { FestivalSnapshot } from "@/lib/types";

/** Same 1 PM–origin “festival day” axis as the schedule UI (13:00 → … → 01:00, continuous). */
function festMFromSlotHm(hm: string): number {
  return wallMinutesToFestivalTimeline(parseHmRelaxed(hm));
}

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

const ACT_FONT =
  "700 {px}px system-ui, -apple-system, Segoe UI, sans-serif";
const REST_FONT =
  "400 {px}px system-ui, -apple-system, Segoe UI, sans-serif";
const SEP = " | ";

function lineHeightPx(fontPx: number): number {
  return fontPx * 1.22;
}

type SlotBox = { y0: number; h: number; w: number; x: number };

function measureSlotRowWidth(
  ctx: CanvasRenderingContext2D,
  s: PlanCalendarSlot,
  px: number
): number {
  ctx.font = ACT_FONT.replace("{px}", String(px));
  const wAct = ctx.measureText(s.act).width;
  ctx.font = REST_FONT.replace("{px}", String(px));
  return (
    wAct +
    ctx.measureText(SEP).width +
    ctx.measureText(s.stage).width +
    ctx.measureText(SEP).width +
    ctx.measureText(`${s.start}-${s.end}`).width
  );
}

function drawSlotRow(
  ctx: CanvasRenderingContext2D,
  s: PlanCalendarSlot,
  tx: number,
  ty: number,
  fontPx: number
): void {
  let x = tx;
  ctx.font = ACT_FONT.replace("{px}", String(fontPx));
  ctx.fillStyle = "#0f172a";
  ctx.fillText(s.act, x, ty);
  x += ctx.measureText(s.act).width;

  ctx.font = REST_FONT.replace("{px}", String(fontPx));
  ctx.fillStyle = "#334155";
  ctx.fillText(SEP, x, ty);
  x += ctx.measureText(SEP).width;
  ctx.fillText(s.stage, x, ty);
  x += ctx.measureText(s.stage).width;
  ctx.fillText(SEP, x, ty);
  x += ctx.measureText(SEP).width;
  ctx.fillText(`${s.start}-${s.end}`, x, ty);
}

/**
 * Largest shared font size so each row “artist | stage | time” fits;
 * per-slot step-down if one slot is tighter.
 */
function planRowLineFont(
  ctx: CanvasRenderingContext2D,
  slots: PlanCalendarSlot[],
  boxes: SlotBox[],
  innerPad: number,
  minPx: number,
  maxPx: number
): number[] {
  const n = slots.length;
  const out: number[] = new Array(n);
  if (n === 0) return out;

  let lo = minPx;
  let hi = maxPx;
  let uniform = minPx;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    let ok = true;
    const lh = lineHeightPx(mid);
    for (let i = 0; i < n; i++) {
      const s = slots[i]!;
      const b = boxes[i]!;
      const maxTextW = b.w - innerPad * 2;
      if (lh + innerPad * 2 > b.h || maxTextW <= 0) {
        ok = false;
        break;
      }
      if (measureSlotRowWidth(ctx, s, mid) > maxTextW) {
        ok = false;
        break;
      }
    }
    if (ok) {
      uniform = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  for (let i = 0; i < n; i++) {
    const s = slots[i]!;
    const b = boxes[i]!;
    const maxTextW = Math.max(4, b.w - innerPad * 2);
    let px = uniform;
    const fits = (size: number): boolean => {
      const lh = lineHeightPx(size);
      if (lh + innerPad * 2 > b.h) return false;
      return measureSlotRowWidth(ctx, s, size) <= maxTextW;
    };
    while (!fits(px) && px > minPx) px -= 1;
    out[i] = px;
  }
  return out;
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
    .sort((a, b) => festMFromSlotHm(a.start) - festMFromSlotHm(b.start));
}

export function buildEveryoneCalendarSlotsForDay(
  group: FestivalSnapshot,
  dayLabel: string
): PlanCalendarSlot[] {
  const ids = new Set<string>();
  for (const m of group.members) {
    for (const s of group.schedule) {
      if (memberContributesToGroupPlan(group, m.id, s.id)) ids.add(s.id);
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
    .sort((a, b) => festMFromSlotHm(a.start) - festMFromSlotHm(b.start));
}

function strokeFootprintWalkIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale / 24, scale / 24);
  ctx.translate(-12, -12);
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1.85;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const paths = [
    "M5.5 17.5v-1.9a3.2 3.2 0 0 0-1.6-2.8 1.6 1.6 0 0 0 1.6 1.6h1.2a1.6 1.6 0 0 0 1.6-1.6 3.2 3.2 0 0 0-1.6-2.9V10",
    "M7 20.5a1.6 1.6 0 1 0 3.2 0 3.2 3.2 0 0 0-1.6-2.9V13",
    "M12.8 17.5v-1.9a3.2 3.2 0 0 1 1.6-2.8 1.6 1.6 0 0 1-1.6 1.6h-1.2a1.6 1.6 0 0 1-1.6-1.6 3.2 3.2 0 0 1 1.6-2.9V10",
    "M14.3 20.5a1.6 1.6 0 1 1-3.2 0 3.2 3.2 0 0 1 1.6-2.9V13",
  ];
  for (const d of paths) {
    try {
      const p = new Path2D(d);
      ctx.stroke(p);
    } catch {
      /* Path2D SVG not supported */
    }
  }
  ctx.restore();
}

function drawWalkBandsOnCanvas(
  ctx: CanvasRenderingContext2D,
  bands: PlanWalkBand[],
  minM: number,
  pxPerMin: number,
  bodyTop: number,
  boxX: number,
  boxW: number
): void {
  ctx.save();
  const pad = 8;
  for (const band of bands) {
    const y0 = bodyTop + (band.fromM - minM) * pxPerMin;
    const y1 = bodyTop + (band.toM - minM) * pxPerMin;
    const h = Math.max(y1 - y0, 8);
    const x = boxX;
    const w = boxW;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y0, w, h);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y0, w, h);
    const midY = y0 + h / 2;
    const iconSize = Math.min(22, Math.max(14, h - 4));
    if (h >= 14 && w > 52) {
      strokeFootprintWalkIcon(ctx, x + pad + iconSize / 2, midY, iconSize);
      ctx.font = "700 13px system-ui, Segoe UI, sans-serif";
      ctx.fillStyle = "#1e293b";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(band.label, x + pad + iconSize + 6, midY);
    } else {
      if (h >= 12 && w > 28) {
        strokeFootprintWalkIcon(ctx, x + w / 2 - 10, midY, 16);
      }
      ctx.font = "700 11px system-ui, Segoe UI, sans-serif";
      ctx.fillStyle = "#334155";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(band.label, x + w / 2, midY + (h >= 12 && w > 28 ? 8 : 0));
    }
  }
  ctx.restore();
}

/** Portrait 9:16; top ~1/3 reserved for lock-screen clock, grid below. */
export function renderPlanWallpaperCalendarPng(
  dayLabel: string,
  title: string,
  slots: PlanCalendarSlot[],
  walkBands?: PlanWalkBand[]
): Promise<Blob> {
  const W = 1080;
  const H = 1920;
  const pad = 24;
  const lockReserveY = Math.floor(H / 3);
  const headerBlock = title.trim() ? 112 : 62;
  const titleBlock = 54;

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
    const a = festMFromSlotHm(s.start);
    const b = festMFromSlotHm(s.end);
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      contentMin = Math.min(contentMin, a, b);
      contentMax = Math.max(contentMax, a, b);
    }
  }
  if (walkBands?.length) {
    for (const b of walkBands) {
      if (Number.isFinite(b.fromM) && Number.isFinite(b.toM)) {
        contentMin = Math.min(contentMin, b.fromM, b.toM);
        contentMax = Math.max(contentMax, b.fromM, b.toM);
      }
    }
  }

  const headerStartY = lockReserveY + 20;
  ctx.fillStyle = "#312e81";
  ctx.font = "700 52px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText(dayLabel, pad, headerStartY + 40);
  if (title.trim()) {
    ctx.font = "600 34px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillStyle = "#6366f1";
    ctx.fillText(title.trim(), pad, headerStartY + 82);
  }

  const topY = headerStartY + headerBlock;
  const bodyH = H - topY - pad;
  const bodyW = W - pad * 2;
  const gridBottom = topY + bodyH;

  if (!Number.isFinite(contentMin) || !Number.isFinite(contentMax)) {
    ctx.fillStyle = "#475569";
    ctx.font = "600 38px system-ui, sans-serif";
    ctx.fillText("Nothing planned this day", pad, topY + 88);
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
  /** Full festival day is 0…1439 (13:00 → 12:59 next segment); allow one step past for tick alignment. */
  maxM = Math.min(1440, maxM);

  const stepM = maxM - minM > 240 ? 60 : maxM - minM > 90 ? 30 : 15;
  minM = Math.floor(minM / stepM) * stepM;
  maxM = Math.ceil(maxM / stepM) * stepM;
  const range = Math.max(stepM, maxM - minM);
  const timelineH = gridBottom - (topY + titleBlock);
  const pxPerMin = timelineH / range;

  const tickCount = Math.floor((maxM - minM) / stepM) + 1;
  const tickFontPx =
    tickCount > 28 ? 22 : tickCount > 18 ? 26 : tickCount > 12 ? 30 : 36;
  const timeGutter = tickFontPx >= 30 ? 124 : tickFontPx >= 26 ? 116 : 104;
  const gridLeft = pad + timeGutter;
  const gridW = bodyW - timeGutter;

  ctx.fillStyle = "rgba(99,102,241,0.12)";
  ctx.fillRect(gridLeft, topY, gridW, titleBlock - 2);
  ctx.fillStyle = "#334155";
  ctx.font = "700 30px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText("Plan", gridLeft + 8, topY + 32);

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
    const label = formatFestivalTickHm(m);
    ctx.fillText(label, pad, y + tickFontPx * 0.35);
  }

  const stageBg = (stage: string) => {
    let h = 0;
    const st = stage.trim();
    for (let i = 0; i < st.length; i++) h = (h * 31 + st.charCodeAt(i)) >>> 0;
    return STAGE_BG[h % STAGE_BG.length]!;
  };

  const innerPad = 14;
  type Placed = {
    slot: PlanCalendarSlot;
    y0: number;
    h: number;
    x: number;
    w: number;
  };
  const placed: Placed[] = [];
  for (const s of slots) {
    const ss = festMFromSlotHm(s.start);
    const ee = festMFromSlotHm(s.end);
    if (Number.isNaN(ss) || Number.isNaN(ee)) continue;
    const lo = Math.min(ss, ee);
    const hi = Math.max(ss, ee);
    const y0 = topY + titleBlock + (lo - minM) * pxPerMin;
    const y1 = topY + titleBlock + (hi - minM) * pxPerMin;
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
  const rowFonts =
    slotArr.length > 0
      ? planRowLineFont(ctx, slotArr, boxes, innerPad, 20, 92)
      : [];

  const prevBaseline = ctx.textBaseline;
  ctx.textBaseline = "top";

  if (walkBands?.length) {
    drawWalkBandsOnCanvas(
      ctx,
      walkBands,
      minM,
      pxPerMin,
      topY + titleBlock,
      gridLeft + 2,
      gridW - 4
    );
  }

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

    const fontPx = rowFonts[i] ?? 22;
    const tx = x + innerPad;
    const lh = lineHeightPx(fontPx);
    const ty = y0 + Math.max(innerPad, (h - lh) / 2);

    drawSlotRow(ctx, s, tx, ty, fontPx);
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
