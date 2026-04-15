import {
  effectiveMemberSlotPlanWindow,
  effectiveMemberWantsSlot,
  memberContributesToGroupPlan,
} from "@/lib/effectiveIntents";
import type { PlanWalkBand } from "@/lib/planWalkBands";
import { walkMinutesBetweenStages } from "@/lib/walkFeasibility";
import {
  formatFestivalTickHm,
  parseHmRelaxed,
  wallMinutesToFestivalTimeline,
} from "@/lib/timeHm";
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
  /** When set, depart this act by this wall time to reach the next planned act on time. */
  leaveBy?: string;
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

function slotTimeSpanText(s: PlanCalendarSlot): string {
  const span = `${s.start} - ${s.end}`;
  if (s.leaveBy) return `${span} (leave ${s.leaveBy})`;
  return span;
}

/** Light diagonal hatch — reads as “travel gap”, not a third event block. */
function strokeWalkGapStripes(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = "rgba(139, 92, 246, 0.22)";
  ctx.lineWidth = 1;
  const step = 7;
  for (let t = -h; t < w + h; t += step) {
    ctx.beginPath();
    ctx.moveTo(x + t, y);
    ctx.lineTo(x + t + h, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

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
    ctx.measureText(slotTimeSpanText(s)).width
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
  ctx.fillText(slotTimeSpanText(s), x, ty);
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
  type Row = { slot: PlanCalendarSlot; stageForWalk: string };
  const rows: Row[] = group.schedule
    .filter(
      (s) =>
        s.dayLabel.trim() === d &&
        effectiveMemberWantsSlot(group, memberId, s.id)
    )
    .map((s) => {
      const w = effectiveMemberSlotPlanWindow(group, memberId, s);
      const slot: PlanCalendarSlot = {
        start: w.planFrom ?? s.start,
        end: w.planTo ?? s.end,
        act: s.artistName,
        stage: s.stageName.trim(),
      };
      return { slot, stageForWalk: s.stageName.trim() };
    })
    .sort(
      (a, b) => festMFromSlotHm(a.slot.start) - festMFromSlotHm(b.slot.start)
    );

  if (!group.walkTimesEnabled) {
    return rows.map((r) => r.slot);
  }

  const out = rows.map((r) => ({ ...r.slot }));
  for (let i = 0; i < out.length - 1; i++) {
    const walk = walkMinutesBetweenStages(
      group,
      rows[i]!.stageForWalk,
      rows[i + 1]!.stageForWalk
    );
    if (walk <= 0) continue;
    const nextStartM = festMFromSlotHm(out[i + 1]!.start);
    const endCurM = festMFromSlotHm(out[i]!.end);
    if (Number.isNaN(nextStartM) || Number.isNaN(endCurM)) continue;
    const leaveM = nextStartM - walk;
    if (Number.isNaN(leaveM) || leaveM >= endCurM) continue;
    out[i] = { ...out[i]!, leaveBy: formatFestivalTickHm(leaveM) };
  }
  return out;
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

  const planInnerX = gridLeft + 2;
  const planInnerW = gridW - 4;
  if (walkBands?.length) {
    for (const band of walkBands) {
      if (!Number.isFinite(band.fromM) || !Number.isFinite(band.toM)) continue;
      const y0 = topY + titleBlock + (band.fromM - minM) * pxPerMin;
      const y1 = topY + titleBlock + (band.toM - minM) * pxPerMin;
      const gh = Math.max(y1 - y0, 2);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(planInnerX, y0, planInnerW, gh);
      strokeWalkGapStripes(ctx, planInnerX, y0, planInnerW, gh);
      ctx.strokeStyle = "rgba(139, 92, 246, 0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(planInnerX + 0.5, y0 + 0.5, planInnerW - 1, gh - 1);
      ctx.setLineDash([]);
    }
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
    const x = planInnerX;
    const w = planInnerW;
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
