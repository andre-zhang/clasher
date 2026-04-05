"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { apiJoinSquad } from "@/lib/api";
import { SESSION_STORAGE_KEY, type ClasherSession } from "@/lib/types";
import { useClasher } from "@/context/ClasherContext";

export default function JoinTokenPage() {
  const router = useRouter();
  const routeParams = useParams<{ token?: string }>();
  const { setSessionFromAuth, peekInvite } = useClasher();
  const token = decodeURIComponent(String(routeParams.token ?? ""))
    .trim()
    .toLowerCase();
  const [displayName, setDisplayName] = useState("");
  const [peekName, setPeekName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const info = await peekInvite(token);
      if (!cancelled && info) setPeekName(info.festivalName);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, peekInvite]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const name = displayName.trim();
    if (!name) {
      setErr("Enter the name your squad will see.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiJoinSquad(token, name);
      const session: ClasherSession = {
        squadId: res.squadId,
        memberId: res.memberId,
        memberSecret: res.memberSecret,
        inviteToken: token,
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
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← Back
      </Link>
      <h1 className="mt-6 text-2xl font-bold">Join squad</h1>
      {peekName ? (
        <p className="mt-2 text-sm text-zinc-300">
          Festival:{" "}
          <span className="font-semibold text-white">{peekName}</span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">
          Token: <code className="text-zinc-300">{token || "—"}</code>
        </p>
      )}
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <label className="block">
          <span className="text-sm font-medium text-zinc-300">Your name</span>
          <input
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-violet-500"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Name shown to the group"
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
          {busy ? "Joining…" : "Join squad"}
        </button>
      </form>
    </main>
  );
}
