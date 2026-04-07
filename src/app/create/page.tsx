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
        festivalName.trim() || "My event",
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
      <Link href="/" className="text-sm text-zinc-600 underline">
        ← Back
      </Link>
      <h1 className="mt-6 text-2xl font-bold text-zinc-900">Create a group</h1>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <label className="block">
          <span className="text-sm font-medium text-zinc-800">Event name</span>
          <input
            className="mt-1 w-full border-2 border-zinc-900 bg-white px-3 py-2 text-zinc-900 outline-none"
            value={festivalName}
            onChange={(e) => setFestivalName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-zinc-800">Your name</span>
          <input
            className="mt-1 w-full border-2 border-zinc-900 bg-white px-3 py-2 text-zinc-900 outline-none"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        {err ? (
          <p className="border-2 border-red-800 bg-red-50 px-3 py-2 text-sm text-red-900">
            {err}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="border-2 border-zinc-900 bg-indigo-600 py-3 text-sm font-semibold text-white shadow-[3px_3px_0_0_#18181b] disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </form>
    </main>
  );
}
