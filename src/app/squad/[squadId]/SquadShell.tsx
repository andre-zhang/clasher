"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useClasher } from "@/context/ClasherContext";

const tabs = [
  { href: "lineup", label: "Lineup" },
  { href: "schedule", label: "Schedule" },
  { href: "clashes", label: "Clashes" },
  { href: "invite", label: "Invite" },
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

  useEffect(() => {
    if (loading) return;
    if (!session || session.squadId !== squadId) {
      router.replace("/");
    }
  }, [loading, session, squadId, router]);

  if (loading || !session || session.squadId !== squadId) {
    return (
      <div className="flex min-h-screen items-center justify-center text-zinc-400">
        Loading…
      </div>
    );
  }

  const base = `/squad/${squadId}`;

  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link href="/" className="text-sm font-semibold text-violet-400">
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
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    active
                      ? "bg-violet-600 text-white"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
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
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Sync
            </button>
            <button
              type="button"
              onClick={() => leave()}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Leave
            </button>
          </div>
        </div>
      </header>
      {error ? (
        <div className="mx-auto max-w-3xl px-4 pt-4">
          <p className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
            {error}
          </p>
        </div>
      ) : null}
      <div className="mx-auto max-w-3xl px-4 py-6">{children}</div>
    </div>
  );
}
