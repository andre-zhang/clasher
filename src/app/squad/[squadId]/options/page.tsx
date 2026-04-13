"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ClasherCheckbox } from "@/components/ClasherCheckbox";
import { ScanningOverlay } from "@/components/ScanningOverlay";
import { useClasher } from "@/context/ClasherContext";
import {
  PENDING_LINEUP_NAMES_KEY,
  PENDING_SCHEDULE_DRAFT_KEY,
} from "@/lib/pendingImport";
import {
  buildWalkMatrixFromStageOrder,
  orderScheduleStagesByMap,
} from "@/lib/walkMatrixDefaults";
import {
  normalizeImportedArtistNames,
  normalizeImportedScheduleSlots,
} from "@/lib/importNormalize";

export default function OptionsPage() {
  const {
    group,
    session,
    loadDemoFull,
    deleteSquad,
    analyzeFestivalMap,
    patchSquadOptions,
    parseLineupFile,
    parseScheduleFiles,
  } = useClasher();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [demoBusy, setDemoBusy] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [mapBusy, setMapBusy] = useState(false);
  const [lineupScanBusy, setLineupScanBusy] = useState(false);
  const [scheduleScanBusy, setScheduleScanBusy] = useState(false);
  const mapFileRef = useRef<HTMLInputElement>(null);
  const lineupFileRef = useRef<HTMLInputElement>(null);
  const scheduleFileRef = useRef<HTMLInputElement>(null);

  const [aliasEdit, setAliasEdit] = useState<Record<string, string>>({});

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const scheduleStages = useMemo(
    () =>
      group
        ? [...new Set(group.schedule.map((s) => s.stageName.trim()))].sort()
        : [],
    [group]
  );

  useEffect(() => {
    if (!group) return;
    setAliasEdit({ ...group.stageMapAlias });
  }, [group]);

  if (!group || !session) return null;

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
      setErr("Copy blocked. Select the URL manually.");
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

  async function onMapUploadAndAnalyze(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setMapBusy(true);
    setErr(null);
    try {
      await analyzeFestivalMap(f);
      setMsg("Map analyzed.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMapBusy(false);
    }
  }

  async function onLineupFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !session) return;
    setLineupScanBusy(true);
    setErr(null);
    try {
      const names = await parseLineupFile(f);
      const cleaned = normalizeImportedArtistNames(names);
      if (cleaned.length) {
        sessionStorage.setItem(
          PENDING_LINEUP_NAMES_KEY,
          JSON.stringify(cleaned)
        );
        router.push(`/squad/${session.squadId}/lineup`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLineupScanBusy(false);
    }
  }

  async function onScheduleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!files.length || !session) return;
    setScheduleScanBusy(true);
    setErr(null);
    try {
      const slots = await parseScheduleFiles(files);
      const merged = normalizeImportedScheduleSlots(slots);
      if (merged.length) {
        sessionStorage.setItem(
          PENDING_SCHEDULE_DRAFT_KEY,
          JSON.stringify(merged)
        );
        router.push(`/squad/${session.squadId}/schedule`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScheduleScanBusy(false);
    }
  }

  async function saveWalkToggle(enabled: boolean) {
    setErr(null);
    try {
      await patchSquadOptions({ walkTimesEnabled: enabled });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveAliasesAndMatrix() {
    if (!group) return;
    setErr(null);
    try {
      const ordered = orderScheduleStagesByMap(
        scheduleStages,
        group.mapStageLabels,
        aliasEdit
      );
      const matrix = buildWalkMatrixFromStageOrder(ordered);
      await patchSquadOptions({
        stageAliasJson: aliasEdit,
        walkMatrixJson: matrix,
      });
      setMsg("Stage links and walk times updated.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const scanning = mapBusy || lineupScanBusy || scheduleScanBusy;

  return (
    <div className="space-y-6">
      {scanning ? <ScanningOverlay /> : null}

      <h1 className="text-xl font-bold text-zinc-900">Options</h1>

      <section className="space-y-3">
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

      <section className="space-y-3 border-t border-zinc-300 pt-4">
        <h2 className="text-sm font-bold text-zinc-900">Import lineup</h2>
        <input
          ref={lineupFileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => void onLineupFile(e)}
        />
        <button
          type="button"
          disabled={lineupScanBusy}
          onClick={() => lineupFileRef.current?.click()}
          className="touch-manipulation border-2 border-zinc-900 bg-indigo-600 px-3 py-2.5 text-xs font-semibold text-white shadow-[2px_2px_0_0_#18181b] disabled:opacity-40 min-h-11 min-w-[11rem] sm:min-h-0 sm:py-1.5"
        >
          {lineupScanBusy ? "Working…" : "Upload lineup image"}
        </button>
      </section>

      <section className="space-y-3 border-t border-zinc-300 pt-4">
        <h2 className="text-sm font-bold text-zinc-900">Import schedule</h2>
        <input
          ref={scheduleFileRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => void onScheduleFiles(e)}
        />
        <button
          type="button"
          disabled={scheduleScanBusy}
          onClick={() => scheduleFileRef.current?.click()}
          className="touch-manipulation border-2 border-zinc-900 bg-indigo-600 px-3 py-2.5 text-xs font-semibold text-white shadow-[2px_2px_0_0_#18181b] disabled:opacity-40 min-h-11 min-w-[11rem] sm:min-h-0 sm:py-1.5"
        >
          {scheduleScanBusy ? "Working…" : "Upload schedule images"}
        </button>
      </section>

      <section className="space-y-3 border-t border-zinc-300 pt-4">
        <h2 className="text-sm font-bold text-zinc-900">Festival map</h2>
        <input
          ref={mapFileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => void onMapUploadAndAnalyze(e)}
        />
        <button
          type="button"
          disabled={mapBusy}
          onClick={() => mapFileRef.current?.click()}
          className="touch-manipulation border-2 border-zinc-900 bg-indigo-600 px-3 py-2.5 text-xs font-semibold text-white shadow-[2px_2px_0_0_#18181b] disabled:opacity-40 min-h-11 min-w-[11rem] sm:min-h-0 sm:py-1.5"
        >
          {mapBusy ? "Working…" : "Upload map image"}
        </button>
        {group.mapStageLabels.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-800">
              Map labels to schedule stage
            </p>
            <div className="touch-scroll max-h-56 space-y-1 overflow-y-auto text-xs">
              {group.mapStageLabels.map((label) => (
                <label
                  key={label}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className="w-28 shrink-0 font-mono text-zinc-700">
                    {label}
                  </span>
                  <select
                    className="min-w-[8rem] border border-zinc-900 bg-white px-1 py-0.5"
                    value={aliasEdit[label] ?? ""}
                    onChange={(e) =>
                      setAliasEdit((a) => ({
                        ...a,
                        [label]: e.target.value,
                      }))
                    }
                  >
                    <option value="">-</option>
                    {scheduleStages.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void saveAliasesAndMatrix()}
              className="border-2 border-zinc-900 bg-zinc-900 px-2 py-1 text-xs font-semibold text-white"
            >
              Save matches & rebuild walk times
            </button>
          </div>
        ) : null}
        <ClasherCheckbox
          checked={group.walkTimesEnabled}
          onChange={(v) => void saveWalkToggle(v)}
        >
          Use walk times in clashes and plans
        </ClasherCheckbox>
      </section>

      <section className="border-t border-zinc-300 pt-4">
        <button
          type="button"
          disabled={demoBusy}
          onClick={() => void onDemoFull()}
          className="text-xs text-zinc-500 underline hover:text-zinc-800 disabled:opacity-40"
        >
          {demoBusy ? "Loading demo…" : "Load demo"}
        </button>
      </section>

      <section className="border-t border-zinc-300 pt-4">
        <button
          type="button"
          disabled={delBusy}
          onClick={() => void onDeleteSquad()}
          className="border-2 border-red-800 bg-white px-3 py-2 text-xs font-semibold text-red-900 shadow-[2px_2px_0_0_#991b1b] hover:bg-red-50 disabled:opacity-40"
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
