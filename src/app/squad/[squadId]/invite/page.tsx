"use client";

import { useEffect, useState } from "react";

import { useClasher } from "@/context/ClasherContext";

export default function InvitePage() {
  const { group } = useClasher();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  if (!group) return null;

  const url = origin ? `${origin}/join/${group.inviteToken}` : "";

  async function copyInvite() {
    setMsg(null);
    setErr(null);
    if (!url) {
      setErr("Could not build invite URL yet. Wait a moment and try again.");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setMsg("Invite link copied to clipboard.");
    } catch {
      setErr(
        "Clipboard blocked. Select the link below and copy manually (Ctrl+C)."
      );
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Invite</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Share this HTTPS link on the same site. Friends open it, enter a
          display name, and join the same cloud squad—no passwords.
        </p>
      </div>

      <button
        type="button"
        onClick={() => void copyInvite()}
        className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-500"
      >
        Copy invite link
      </button>

      {msg ? (
        <p className="text-sm font-medium text-emerald-400" role="status">
          {msg}
        </p>
      ) : null}
      {err ? (
        <p className="text-sm font-medium text-amber-300" role="alert">
          {err}
        </p>
      ) : null}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Full URL
        </p>
        <p className="mt-2 break-all font-mono text-sm text-violet-300 select-all">
          {url || "…"}
        </p>
      </div>
    </div>
  );
}
