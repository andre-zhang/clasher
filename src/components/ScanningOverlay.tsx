"use client";

export function ScanningOverlay({ label = "Scanning…" }: { label?: string }) {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-white/85"
      role="status"
      aria-live="polite"
    >
      <div className="border-2 border-dashed border-zinc-800 bg-white px-8 py-6 shadow-[4px_4px_0_0_#18181b]">
        <p className="text-sm font-semibold tracking-wide text-zinc-900">
          {label}
        </p>
        <div className="mt-3 h-1 w-48 overflow-hidden border border-zinc-800 bg-zinc-100">
          <div className="clasher-scan-bar h-full w-1/3 bg-zinc-800" />
        </div>
      </div>
    </div>
  );
}
