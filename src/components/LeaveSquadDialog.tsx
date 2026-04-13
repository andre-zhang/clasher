"use client";

import { useEffect, useId, useState } from "react";

export function LeaveSquadDialog({
  open,
  onClose,
  onConfirmLeave,
}: {
  open: boolean;
  onClose: () => void;
  onConfirmLeave: () => Promise<void>;
}) {
  const titleId = useId();
  const descId = useId();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setBusy(false);
      return;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  async function confirm() {
    setBusy(true);
    try {
      await onConfirmLeave();
    } finally {
      setBusy(false);
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 border-0 bg-zinc-900/55 p-0 transition-opacity hover:bg-zinc-900/60"
        aria-label="Close"
        disabled={busy}
        onClick={() => !busy && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative w-full max-w-md border-2 border-zinc-900 bg-zinc-50 p-6 shadow-[8px_8px_0_0_#18181b]"
      >
        <h2
          id={titleId}
          className="text-lg font-bold tracking-tight text-zinc-900"
        >
          Leave this group?
        </h2>
        <p id={descId} className="mt-3 text-sm leading-relaxed text-zinc-700">
          You will be removed from the squad and your ratings and plans in this
          group will be deleted.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="border-2 border-zinc-900 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow-[3px_3px_0_0_#18181b] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirm()}
            className="border-2 border-red-900 bg-red-700 px-4 py-2.5 text-sm font-semibold text-white shadow-[3px_3px_0_0_#18181b] disabled:opacity-50"
          >
            {busy ? "Leaving…" : "Leave group"}
          </button>
        </div>
      </div>
    </div>
  );
}
