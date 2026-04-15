"use client";

import type { PlanWalkBand } from "@/lib/planWalkBands";
import { LUCIDE_FOOTPRINTS_PATHS } from "@/lib/planWalkIconPaths";

/** Lucide “footprints” (lucide-static, ISC) — reads well at small sizes. */
export function PlanWalkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {LUCIDE_FOOTPRINTS_PATHS.map((d, i) => (
        <path
          key={i}
          d={d}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/**
 * Walk gap between acts: same border weight as schedule slot cards, light fill, walk glyph + minutes.
 */
export function PlanWalkBandBox({
  band,
  topPx,
  heightPx,
  /** `card` matches schedule slot horizontal inset; `full` spans the strip column edge-to-edge. */
  inset = "card",
  className,
}: {
  band: PlanWalkBand;
  topPx: number;
  heightPx: number;
  inset?: "card" | "full";
  className?: string;
}) {
  const h = Math.max(heightPx, 6);
  const showLabel = h >= 12;
  const insetCls = inset === "full" ? "left-0 right-0" : "left-0.5 right-0.5";
  return (
    <div
      className={`pointer-events-none absolute z-[3] flex items-center justify-center gap-1.5 border-2 border-zinc-900 bg-zinc-50 shadow-[1px_1px_0_0_rgba(24,24,27,0.1)] ${insetCls} ${
        className ?? ""
      }`}
      style={{ top: topPx, height: h }}
      aria-hidden
      title={`Walk ${band.label}`}
    >
      <PlanWalkIcon className="h-[15px] w-[15px] shrink-0 text-zinc-700 sm:h-[17px] sm:w-[17px]" />
      {showLabel ? (
        <span className="shrink-0 text-[8px] font-bold tabular-nums leading-none tracking-tight text-zinc-800 sm:text-[9px]">
          {band.label}
        </span>
      ) : null}
    </div>
  );
}
