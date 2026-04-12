"use client";

import { useRef, useState } from "react";

import { ScanningOverlay } from "@/components/ScanningOverlay";
import { ScheduleCalendar } from "@/components/ScheduleCalendar";
import { useClasher } from "@/context/ClasherContext";
import { normalizeImportedScheduleSlots } from "@/lib/importNormalize";
import { buildSlotIntentsFromHotRatings } from "@/lib/syncIntentsFromRatings";
import type { ScheduleDraftSlot } from "@/lib/api";

export default function SchedulePage() {
  const {
    session,
    group,
    replaceSchedule,
    parseScheduleFiles,
    addSlotComment,
    setRating,
    putSlotIntents,
    syncPlanFromGroup,
  } = useClasher();
  const [draft, setDraft] = useState<ScheduleDraftSlot[] | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncGroupBusy, setSyncGroupBusy] = useState(false);
  const [stripHydrateKey, setStripHydrateKey] = useState(0);
  const galleryFileRef = useRef<HTMLInputElement>(null);
  const cameraFileRef = useRef<HTMLInputElement>(null);

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

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!files.length) return;
    setParseErr(null);
    setScanning(true);
    setBusy(true);
    try {
      const slots = await parseScheduleFiles(files);
      setDraft((prev) =>
        normalizeImportedScheduleSlots([...(prev ?? []), ...slots])
      );
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

  async function syncHotToShortlist() {
    if (!group?.schedule.length || !session) return;
    setSyncBusy(true);
    try {
      await putSlotIntents(
        buildSlotIntentsFromHotRatings(group, session.memberId)
      );
    } finally {
      setSyncBusy(false);
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
      {scanning ? <ScanningOverlay /> : null}

      <h1 className="text-xl font-bold text-zinc-900">Schedule</h1>

      <section className="border-2 border-zinc-900 bg-white p-4 shadow-[2px_2px_0_0_#18181b]">
        <h2 className="text-sm font-bold text-zinc-900">Import</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={syncBusy || !group.schedule.length}
            onClick={() => void syncHotToShortlist()}
            className="touch-manipulation border-2 border-zinc-900 bg-white px-3 py-2.5 text-xs font-medium text-zinc-900 shadow-[2px_2px_0_0_#18181b] hover:bg-zinc-100 disabled:opacity-40 min-h-11 sm:min-h-0 sm:py-1.5"
          >
            Sync from Lineup
          </button>
          <button
            type="button"
            onClick={() => cameraFileRef.current?.click()}
            disabled={busy}
            className="touch-manipulation border-2 border-zinc-900 bg-white px-3 py-2.5 text-xs font-medium text-zinc-900 shadow-[2px_2px_0_0_#18181b] hover:bg-zinc-100 disabled:opacity-50 min-h-11 sm:min-h-0 sm:py-1.5"
          >
            Take photo
          </button>
          <button
            type="button"
            onClick={() => galleryFileRef.current?.click()}
            disabled={busy}
            className="touch-manipulation border-2 border-zinc-900 bg-zinc-900 px-3 py-2.5 text-xs font-medium text-white shadow-[2px_2px_0_0_#18181b] hover:bg-zinc-800 disabled:opacity-50 min-h-11 sm:min-h-0 sm:py-1.5"
          >
            Upload images
          </button>
          <input
            ref={cameraFileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only fixed left-0 top-0 h-px w-px opacity-0"
            aria-hidden
            tabIndex={-1}
            onChange={onFiles}
          />
          <input
            ref={galleryFileRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only fixed left-0 top-0 h-px w-px opacity-0"
            aria-hidden
            tabIndex={-1}
            onChange={onFiles}
          />
        </div>
      </section>

      {parseErr ? (
        <p className="border-2 border-red-800 bg-red-50 px-3 py-2 text-sm text-red-900">
          {parseErr}
        </p>
      ) : null}

      {draft && draft.length > 0 ? (
        <div className="border-2 border-zinc-900 bg-white p-4 shadow-[3px_3px_0_0_#18181b]">
          <p className="text-sm font-semibold text-zinc-900">
            Draft ({draft.length})
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
              onClick={() => galleryFileRef.current?.click()}
              disabled={busy}
              className="border-2 border-zinc-900 bg-white px-2 py-1 text-xs font-medium"
            >
              Add more scans
            </button>
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
              className="border-2 border-zinc-900 bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white shadow-[2px_2px_0_0_#18181b] disabled:opacity-50"
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

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={syncGroupBusy || !group.schedule.length}
          onClick={() => {
            setSyncGroupBusy(true);
            void (async () => {
              try {
                await syncPlanFromGroup();
              } finally {
                setSyncGroupBusy(false);
              }
            })();
          }}
          className="touch-manipulation border-2 border-zinc-900 bg-white px-3 py-2 text-xs font-medium text-zinc-900 shadow-[2px_2px_0_0_#18181b] hover:bg-zinc-100 disabled:opacity-40"
        >
          {syncGroupBusy ? "Syncing…" : "Sync mine with everyone"}
        </button>
        <p className="max-w-md text-[11px] text-zinc-600">
          Copies every act anyone in the group keeps onto your plan (full listed
          times). New members get this automatically once when they join.
        </p>
      </div>

      <ScheduleCalendar
        schedule={group.schedule}
        allMemberSlotIntents={group.allMemberSlotIntents}
        group={group}
        slotComments={group.slotComments}
        onAddSlotComment={addSlotComment}
        visibilityMode="effectivePlan"
        scheduleViewerMemberId={session.memberId}
        onSetRating={(artistId, tier) => setRating(artistId, tier)}
        buildPlanner={{
          memberId: session.memberId,
          stripHydrateKey,
          onApplyPlan: async (patches) => {
            await putSlotIntents(patches);
            setStripHydrateKey((k) => k + 1);
          },
        }}
      />

      {group.schedule.length > 0 ? (
        <button
          type="button"
          onClick={() => void commitCurrentTable()}
          disabled={busy}
          className="text-xs text-zinc-600 underline"
        >
          Re-save schedule
        </button>
      ) : null}
    </div>
  );
}
