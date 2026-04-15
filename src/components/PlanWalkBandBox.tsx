"use client";

import type { PlanWalkBand } from "@/lib/planWalkBands";

/** Small walking figure (24×24), stroke-based for crisp scaling. */
export function PlanWalkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="10" cy="5.5" r="2.25" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M10 8.5v4.2M10 8.5l3.2 2M10 8.5l-3 2.2M10 12.7l-2.2 5M10 12.7l2.4 4.8M15 10.5l2.8 1.6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
      className={`pointer-events-none absolute z-[3] flex items-center justify-center gap-0.5 border-2 border-zinc-900 bg-white/95 shadow-[1px_1px_0_0_rgba(24,24,27,0.12)] ${insetCls} ${
        className ?? ""
      }`}
      style={{ top: topPx, height: h }}
      aria-hidden
      title={`Walk ${band.label}`}
    >
      <PlanWalkIcon className="h-3 w-3 shrink-0 text-zinc-700 sm:h-3.5 sm:w-3.5" />
      {showLabel ? (
        <span className="shrink-0 text-[8px] font-bold tabular-nums leading-none text-zinc-800 sm:text-[9px]">
          {band.label}
        </span>
      ) : null}
    </div>
  );
}
