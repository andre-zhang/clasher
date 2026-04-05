"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiCreateSquad } from "@/lib/api";
import { SESSION_STORAGE_KEY, type ClasherSession } from "@/lib/types";
import { useClasher } from "@/context/ClasherContext";

export default function CreatePage() {
  const router = useRouter();
  const { setSessionFromAuth } = useClasher();
  const [festivalName, setFestivalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await apiCreateSquad(
        festivalName.trim() || "My festival",
        displayName.trim() || "You"
      );
      const session: ClasherSession = {
        squadId: res.squadId,
        memberId: res.memberId,
        memberSecret: res.memberSecret,
        inviteToken: res.inviteToken,
      };
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify(session)
        );
      }
      setSessionFromAuth(session, res.group);
      router.push(`/squad/${res.squadId}/lineup`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <Link
        href="/"
        className="text-sm text-zinc-500 hover:text-zinc-300"
      >
        ← Back
      </Link>
      <h1 className="mt-6 text-2xl font-bold">Create a squad</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Stored on your Postgres-backed API. You get an HTTPS invite link on this
        site. Display names only—this device stores your member secret.
      </p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <label className="block">
          <span className="text-sm font-medium text-zinc-300">
            Festival name
          </span>
          <input
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-violet-500"
            value={festivalName}
            onChange={(e) => setFestivalName(e.target.value)}
            placeholder="e.g. Riverside Sound 2026"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-zinc-300">Your name</span>
          <input
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-violet-500"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How friends see you"
          />
        </label>
        {err ? (
          <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {err}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-violet-600 py-3 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create squad"}
        </button>
      </form>
    </main>
  );
}
