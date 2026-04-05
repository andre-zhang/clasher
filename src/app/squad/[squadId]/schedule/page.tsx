"use client";

import { useRef, useState } from "react";

import { useClasher } from "@/context/ClasherContext";
import type { ScheduleDraftSlot } from "@/lib/api";

export default function SchedulePage() {
  const {
    group,
    replaceSchedule,
    loadDemoLineup,
    loadDemoSchedule,
    parseScheduleFile,
  } = useClasher();
  const [draft, setDraft] = useState<ScheduleDraftSlot[] | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!group) return null;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setParseErr(null);
    setBusy(true);
    try {
      const slots = await parseScheduleFile(f);
      setDraft(slots);
    } catch (err) {
      setParseErr(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function commitDraft() {
    if (!draft?.length) return;
    setBusy(true);
    setParseErr(null);
    try {
      await replaceSchedule(draft);
      setDraft(null);
    } catch (err) {
      setParseErr(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function commitCurrentTable() {
    const g = group;
    if (!g) return;
    const slots: ScheduleDraftSlot[] = g.schedule.map((s) => ({
      dayLabel: s.dayLabel,
      stageName: s.stageName,
      start: s.start,
      end: s.end,
      artistName: s.artistName,
    }));
    setBusy(true);
    setParseErr(null);
    try {
      await replaceSchedule(slots);
    } catch (err) {
      setParseErr(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Schedule</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Timetable lives on the server. Scan a screenshot or load the demo
          (demo lineup first).
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void loadDemoLineup()}
          className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
        >
          Demo lineup
        </button>
        <button
          type="button"
          onClick={() => void loadDemoSchedule()}
          className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
        >
          Demo timetable
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
        >
          Scan timetable image
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFile}
        />
      </div>

      {parseErr ? (
        <p className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {parseErr}
        </p>
      ) : null}

      {draft && draft.length > 0 ? (
        <div className="rounded-xl border border-violet-900/50 bg-violet-950/20 p-4">
          <p className="text-sm font-medium text-violet-200">
            Review scanned slots ({draft.length})
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Committing replaces the whole squad schedule with these rows (server
            creates missing artists).
          </p>
          <div className="mt-3 max-h-48 overflow-auto text-xs">
            <table className="w-full text-left text-zinc-300">
              <thead>
                <tr className="border-b border-zinc-700 text-zinc-500">
                  <th className="py-1 pr-2">Day</th>
                  <th className="py-1 pr-2">Stage</th>
                  <th className="py-1 pr-2">Start</th>
                  <th className="py-1 pr-2">End</th>
                  <th className="py-1">Artist</th>
                </tr>
              </thead>
              <tbody>
                {draft.slice(0, 30).map((s, i) => (
                  <tr key={i} className="border-b border-zinc-800">
                    <td className="py-1 pr-2">{s.dayLabel}</td>
                    <td className="py-1 pr-2">{s.stageName}</td>
                    <td className="py-1 pr-2">{s.start}</td>
                    <td className="py-1 pr-2">{s.end}</td>
                    <td className="py-1">{s.artistName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void commitDraft()}
              disabled={busy}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              Commit schedule
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Current server schedule
        </h2>
        {group.schedule.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No slots yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead>
                <tr className="border-b border-zinc-700 text-zinc-500">
                  <th className="py-2 pr-3">Day</th>
                  <th className="py-2 pr-3">Stage</th>
                  <th className="py-2 pr-3">Start</th>
                  <th className="py-2 pr-3">End</th>
                  <th className="py-2">Artist</th>
                </tr>
              </thead>
              <tbody>
                {group.schedule.map((s) => (
                  <tr key={s.id} className="border-b border-zinc-800">
                    <td className="py-2 pr-3">{s.dayLabel}</td>
                    <td className="py-2 pr-3">{s.stageName}</td>
                    <td className="py-2 pr-3">{s.start}</td>
                    <td className="py-2 pr-3">{s.end}</td>
                    <td className="py-2">{s.artistName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {group.schedule.length > 0 ? (
          <button
            type="button"
            onClick={() => void commitCurrentTable()}
            disabled={busy}
            className="mt-3 text-xs text-zinc-500 underline hover:text-zinc-300"
          >
            Re-save current table (refresh IDs)
          </button>
        ) : null}
      </div>
    </div>
  );
}
