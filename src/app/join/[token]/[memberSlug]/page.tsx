"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { apiResumeSquad } from "@/lib/api";
import { SESSION_STORAGE_KEY, type ClasherSession } from "@/lib/types";
import { useClasher } from "@/context/ClasherContext";

export default function JoinMemberSlugPage() {
  const router = useRouter();
  const routeParams = useParams<{ token?: string; memberSlug?: string }>();
  const { setSessionFromAuth, peekInvite } = useClasher();
  const token = decodeURIComponent(String(routeParams.token ?? ""))
    .trim()
    .toLowerCase();
  const memberSlug = decodeURIComponent(
    String(routeParams.memberSlug ?? "")
  ).trim();
  const [peekName, setPeekName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setErr(null);
      if (!token || !memberSlug) {
        setBusy(false);
        setErr("Invalid link.");
        return;
      }
      setBusy(true);
      try {
        const res = await apiResumeSquad(token, { slug: memberSlug });
        if (cancelled) return;
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
        router.replace(`/squad/${res.squadId}/lineup`);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, memberSlug, router, setSessionFromAuth]);

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <Link href="/" className="text-sm text-zinc-600 underline">
        ← Back
      </Link>
      <h1 className="mt-6 text-2xl font-bold text-zinc-900">Open your group</h1>
      {peekName ? (
        <p className="mt-2 text-sm text-zinc-700">
          <span className="font-semibold">{peekName}</span>
        </p>
      ) : (
        <p className="mt-2 font-mono text-xs text-zinc-500">{token || "—"}</p>
      )}
      {busy ? (
        <p className="mt-8 text-sm text-zinc-600">Signing you in…</p>
      ) : err ? (
        <div className="mt-8 space-y-4">
          <p className="border-2 border-red-800 bg-red-50 px-3 py-2 text-sm text-red-900">
            {err}
          </p>
          <p className="text-sm text-zinc-700">
            Try the{" "}
            <Link
              href={`/join/${encodeURIComponent(token)}`}
              className="font-semibold text-indigo-700 underline"
            >
              invite page
            </Link>{" "}
            and use <strong>Log back in</strong> with the same name you joined
            with.
          </p>
        </div>
      ) : null}
    </main>
  );
}
