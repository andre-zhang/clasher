"use client";

import type { PlanWalkBand } from "@/lib/planWalkBands";

/**
 * Walk / travel gap: very light purple band (no icon). Shown only when the gap
 * between acts is tight enough that a dedicated walk buffer is meaningful.
 */
export function PlanWalkBandBox({
  band,
  topPx,
  heightPx,
  inset = "card",
  className,
}: {
  band: PlanWalkBand;
  topPx: number;
  heightPx: number;
  inset?: "card" | "full";
  className?: string;
}) {
  const h = Math.max(heightPx, 3);
  /** Match schedule slot cards (`left-0.5 right-0.5`); strip uses full width. */
  const insetCls = inset === "full" ? "left-0 right-0" : "left-0.5 right-0.5";
  /** Diagonal stripes read as “travel buffer” without competing with solid set blocks. */
  const stripeBg = `repeating-linear-gradient(
    -52deg,
    rgba(255, 255, 255, 0.5) 0 6px,
    rgba(167, 139, 250, 0.2) 6px 7px
  )`;
  return (
    <div
      className={`pointer-events-none absolute z-[3] box-border rounded-sm border border-violet-400/45 ${insetCls} ${
        className ?? ""
      }`}
      style={{
        top: topPx,
        height: h,
        backgroundImage: stripeBg,
      }}
      aria-hidden
      title={`Walk ~${band.label}`}
    />
  );
}
