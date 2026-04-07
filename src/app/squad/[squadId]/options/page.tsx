"use client";

import { useEffect, useState } from "react";

import { useClasher } from "@/context/ClasherContext";

export default function OptionsPage() {
  const { group, loadDemoFull, deleteSquad } = useClasher();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [demoBusy, setDemoBusy] = useState(false);
  const [delBusy, setDelBusy] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  if (!group) return null;

  const url = origin ? `${origin}/join/${group.inviteToken}` : "";

  async function copyInvite() {
    setMsg(null);
    setErr(null);
    if (!url) {
      setErr("URL not ready.");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setMsg("Copied.");
    } catch {
      setErr("Copy blocked — select the URL manually.");
    }
  }

  async function onDemoFull() {
    setDemoBusy(true);
    setErr(null);
    try {
      await loadDemoFull();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDemoBusy(false);
    }
  }

  async function onDeleteSquad() {
    if (
      !confirm(
        "Delete this group and all lineup, schedule, and ratings? This cannot be undone."
      )
    ) {
      return;
    }
    setDelBusy(true);
    setErr(null);
    try {
      await deleteSquad();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDelBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-zinc-900">Options</h1>

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
          Invite
        </h2>
        <button
          type="button"
          onClick={() => void copyInvite()}
          className="border-2 border-zinc-900 bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-[3px_3px_0_0_#18181b]"
        >
          Copy link
        </button>

        {msg ? (
          <p className="text-sm font-medium text-emerald-800" role="status">
            {msg}
          </p>
        ) : null}

        <div className="border-2 border-zinc-900 bg-white p-3 shadow-[2px_2px_0_0_#18181b]">
          <p className="break-all font-mono text-sm text-zinc-900 select-all">
            {url || "…"}
          </p>
        </div>
      </section>

      <section className="border-t border-zinc-300 pt-4">
        <button
          type="button"
          disabled={demoBusy}
          onClick={() => void onDemoFull()}
          className="text-xs text-zinc-500 underline hover:text-zinc-800 disabled:opacity-40"
        >
          {demoBusy
            ? "Loading demo…"
            : "Load demo data (lineup + schedule + sample group)"}
        </button>
      </section>

      <section className="border-t border-zinc-300 pt-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500">
          Danger
        </h2>
        <button
          type="button"
          disabled={delBusy}
          onClick={() => void onDeleteSquad()}
          className="mt-2 border-2 border-red-800 bg-white px-3 py-2 text-xs font-semibold text-red-900 shadow-[2px_2px_0_0_#991b1b] hover:bg-red-50 disabled:opacity-40"
        >
          {delBusy ? "Deleting…" : "Delete group"}
        </button>
      </section>

      {err ? (
        <p className="text-sm font-medium text-amber-900" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
