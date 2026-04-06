"use client";

import { useRef, useState } from "react";

import { ScanningOverlay } from "@/components/ScanningOverlay";
import { ScheduleCalendar } from "@/components/ScheduleCalendar";
import { useClasher } from "@/context/ClasherContext";
import { normalizeImportedScheduleSlots } from "@/lib/importNormalize";
import type { ScheduleDraftSlot } from "@/lib/api";

export default function SchedulePage() {
  const { session, group, replaceSchedule, parseScheduleFile } = useClasher();
  const [draft, setDraft] = useState<ScheduleDraftSlot[] | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [calendarMode, setCalendarMode] = useState<"mine" | "all">("mine");
  const fileRef = useRef<HTMLInputElement>(null);

  if (!group || !session) return null;

  function patchDraftSlot(
    index: number,
    patch: Partial<ScheduleDraftSlot>
  ) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const row = next[index];
      if (!row) return prev;
      next[index] = { ...row, ...patch };
      return next;
    });
  }

  function removeDraftRow(index: number) {
    setDraft((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  function addDraftRow() {
    setDraft((prev) => [
      ...(prev ?? []),
      {
        dayLabel: "",
        stageName: "",
        start: "",
        end: "",
        artistName: "",
      },
    ]);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setParseErr(null);
    setScanning(true);
    setBusy(true);
    try {
      const slots = await parseScheduleFile(f);
      setDraft(normalizeImportedScheduleSlots(slots));
    } catch (err) {
      setParseErr(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
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
    <div className="space-y-6">
      {scanning ? <ScanningOverlay label="Scanning timetable…" /> : null}

      <h1 className="text-xl font-bold text-zinc-900">Schedule</h1>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="border-2 border-zinc-900 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white shadow-[2px_2px_0_0_#18181b] hover:bg-zinc-800 disabled:opacity-50"
        >
          Scan timetable
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
        <p className="border-2 border-red-800 bg-red-50 px-3 py-2 text-sm text-red-900">
          {parseErr}
        </p>
      ) : null}

      {draft && draft.length > 0 ? (
        <div className="border-2 border-zinc-900 bg-indigo-50 p-4 shadow-[3px_3px_0_0_#18181b]">
          <p className="text-sm font-semibold text-zinc-900">
            Edit before commit ({draft.length})
          </p>
          <div className="mt-2 max-h-72 overflow-auto text-xs">
            <table className="w-full border-collapse border border-zinc-900 text-left">
              <thead>
                <tr className="bg-zinc-100">
                  <th className="border border-zinc-700 px-1 py-0.5">Day</th>
                  <th className="border border-zinc-700 px-1 py-0.5">Stage</th>
                  <th className="border border-zinc-700 px-1 py-0.5">Start</th>
                  <th className="border border-zinc-700 px-1 py-0.5">End</th>
                  <th className="border border-zinc-700 px-1 py-0.5">Artist</th>
                  <th className="border border-zinc-700 px-1 py-0.5" />
                </tr>
              </thead>
              <tbody>
                {draft.map((s, i) => (
                  <tr key={i}>
                    <td className="border border-zinc-300 p-0">
                      <input
                        className="w-full min-w-[3rem] bg-white px-1 py-0.5"
                        value={s.dayLabel}
                        onChange={(e) =>
                          patchDraftSlot(i, { dayLabel: e.target.value })
                        }
                      />
                    </td>
                    <td className="border border-zinc-300 p-0">
                      <input
                        className="w-full min-w-[4rem] bg-white px-1 py-0.5"
                        value={s.stageName}
                        onChange={(e) =>
                          patchDraftSlot(i, { stageName: e.target.value })
                        }
                      />
                    </td>
                    <td className="border border-zinc-300 p-0">
                      <input
                        className="w-full min-w-[3rem] bg-white px-1 py-0.5 font-mono"
                        value={s.start}
                        onChange={(e) =>
                          patchDraftSlot(i, { start: e.target.value })
                        }
                      />
                    </td>
                    <td className="border border-zinc-300 p-0">
                      <input
                        className="w-full min-w-[3rem] bg-white px-1 py-0.5 font-mono"
                        value={s.end}
                        onChange={(e) =>
                          patchDraftSlot(i, { end: e.target.value })
                        }
                      />
                    </td>
                    <td className="border border-zinc-300 p-0">
                      <input
                        className="w-full min-w-[6rem] bg-white px-1 py-0.5"
                        value={s.artistName}
                        onChange={(e) =>
                          patchDraftSlot(i, { artistName: e.target.value })
                        }
                      />
                    </td>
                    <td className="border border-zinc-300 px-1">
                      <button
                        type="button"
                        className="text-red-800 underline"
                        onClick={() => removeDraftRow(i)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addDraftRow}
              className="border-2 border-zinc-900 bg-white px-2 py-1 text-xs font-medium"
            >
              Add row
            </button>
            <button
              type="button"
              onClick={() => void commitDraft()}
              disabled={busy}
              className="border-2 border-zinc-900 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[2px_2px_0_0_#18181b] disabled:opacity-50"
            >
              Commit
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="text-xs text-zinc-600 underline"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCalendarMode("mine")}
          className={`border-2 px-2 py-1 text-xs font-semibold ${
            calendarMode === "mine"
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-900 bg-white text-zinc-900"
          }`}
        >
          Your plan
        </button>
        <button
          type="button"
          onClick={() => setCalendarMode("all")}
          className={`border-2 px-2 py-1 text-xs font-semibold ${
            calendarMode === "all"
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-900 bg-white text-zinc-900"
          }`}
        >
          Full timetable
        </button>
      </div>

      <ScheduleCalendar
        schedule={group.schedule}
        memberId={calendarMode === "mine" ? session.memberId : undefined}
        allMemberSlotIntents={group.allMemberSlotIntents}
        group={group}
        caption={
          calendarMode === "mine"
            ? "Slots you’re keeping (clash picks + slot flags). Hidden sets are dropped from your plan."
            : "Everything on the squad timetable."
        }
      />

      {group.schedule.length > 0 ? (
        <button
          type="button"
          onClick={() => void commitCurrentTable()}
          disabled={busy}
          className="text-xs text-zinc-600 underline"
        >
          Re-save schedule (refresh slot IDs)
        </button>
      ) : null}
    </div>
  );
}
