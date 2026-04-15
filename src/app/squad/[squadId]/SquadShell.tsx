"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { LeaveSquadDialog } from "@/components/LeaveSquadDialog";
import { useClasher } from "@/context/ClasherContext";

const tabs = [
  { href: "lineup", label: "Lineup" },
  { href: "schedule", label: "Schedule" },
  { href: "clashes", label: "Clashes" },
  { href: "plans", label: "Plans" },
  { href: "options", label: "Options" },
] as const;

export function SquadShell({
  squadId,
  children,
}: {
  squadId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, loading, error, leave, refresh } = useClasher();
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!session || session.squadId !== squadId) {
      router.replace("/");
    }
  }, [loading, session, squadId, router]);

  if (loading || !session || session.squadId !== squadId) {
    return (
      <div className="flex min-h-screen items-center justify-center text-zinc-500">
        Loading…
      </div>
    );
  }

  const base = `/squad/${squadId}`;

  return (
    <div className="min-h-screen pb-20">
      <LeaveSquadDialog
        open={leaveDialogOpen}
        onClose={() => setLeaveDialogOpen(false)}
        onConfirmLeave={leave}
      />
      <header className="sticky top-0 z-10 border-b-2 border-zinc-900 bg-zinc-100">
        <div className="mx-auto flex max-w-[min(100%,80rem)] flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link
            href="/"
            className="text-sm font-bold tracking-tight text-zinc-900"
          >
            Clasher
          </Link>
          <nav className="flex flex-wrap gap-1">
            {tabs.map((t) => {
              const href = `${base}/${t.href}`;
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={t.href}
                  href={href}
                  className={`border-2 px-2 py-1 text-xs font-semibold ${
                    active
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-transparent bg-white text-zinc-800 hover:border-zinc-900"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="text-xs text-zinc-600 underline"
            >
              Sync
            </button>
            <button
              type="button"
              onClick={() => setLeaveDialogOpen(true)}
              className="border-2 border-red-800 bg-white px-2 py-0.5 text-xs font-semibold text-red-800"
            >
              Leave
            </button>
          </div>
        </div>
      </header>
      {error ? (
        <div className="mx-auto max-w-[min(100%,80rem)] px-4 pt-4">
          <p className="border-2 border-amber-800 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {error}
          </p>
        </div>
      ) : null}
      <div className="mx-auto max-w-[min(100%,80rem)] px-4 py-6">{children}</div>
    </div>
  );
}
