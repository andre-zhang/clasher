"use client";

import type { PlanWalkBand } from "@/lib/planWalkBands";

/**
 * Footprints-style glyph (Lucide “footprints”-style paths), tuned for ~12–16px display.
 */
export function PlanWalkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M5.5 17.5v-1.9a3.2 3.2 0 0 0-1.6-2.8 1.6 1.6 0 0 0 1.6 1.6h1.2a1.6 1.6 0 0 0 1.6-1.6 3.2 3.2 0 0 0-1.6-2.9V10"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 20.5a1.6 1.6 0 1 0 3.2 0 3.2 3.2 0 0 0-1.6-2.9V13"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.8 17.5v-1.9a3.2 3.2 0 0 1 1.6-2.8 1.6 1.6 0 0 1-1.6 1.6h-1.2a1.6 1.6 0 0 1-1.6-1.6 3.2 3.2 0 0 1 1.6-2.9V10"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.3 20.5a1.6 1.6 0 1 1-3.2 0 3.2 3.2 0 0 1 1.6-2.9V13"
        stroke="currentColor"
        strokeWidth="1.85"
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
      className={`pointer-events-none absolute z-[3] flex items-center justify-center gap-1 border-2 border-zinc-900 bg-white shadow-[1px_1px_0_0_rgba(24,24,27,0.1)] ${insetCls} ${
        className ?? ""
      }`}
      style={{ top: topPx, height: h }}
      aria-hidden
      title={`Walk ${band.label}`}
    >
      <PlanWalkIcon className="h-3.5 w-3.5 shrink-0 text-zinc-700 sm:h-4 sm:w-4" />
      {showLabel ? (
        <span className="shrink-0 text-[8px] font-bold tabular-nums leading-none tracking-tight text-zinc-800 sm:text-[9px]">
          {band.label}
        </span>
      ) : null}
    </div>
  );
}
