"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useClasher } from "@/context/ClasherContext";
import {
  buildWalkMatrixFromStageOrder,
  orderScheduleStagesByMap,
} from "@/lib/walkMatrixDefaults";

export default function OptionsPage() {
  const {
    group,
    session,
    loadDemoFull,
    deleteSquad,
    uploadFestivalMap,
    analyzeFestivalMap,
    patchSquadOptions,
  } = useClasher();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [demoBusy, setDemoBusy] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [mapBusy, setMapBusy] = useState(false);
  const [mapPreview, setMapPreview] = useState<{
    mime: string;
    data: string;
  } | null>(null);
  const mapRef = useRef<HTMLInputElement>(null);
  const analyzeRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!group?.hasFestivalMap || !session) {
      setMapPreview(null);
      return;
    }
    void (async () => {
      try {
        const r = await fetch(
          `/api/squads/${session.squadId}/festival-map`,
          { headers: { Authorization: `Bearer ${session.memberSecret}` } }
        );
        if (!r.ok) return;
        const j = (await r.json()) as { mime?: string; data?: string };
        if (j.data && j.mime) setMapPreview({ mime: j.mime, data: j.data });
      } catch {
        /* ignore */
      }
    })();
  }, [group?.hasFestivalMap, group?.id, session]);

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

  async function onMapPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setMapBusy(true);
    setErr(null);
    try {
      await uploadFestivalMap(f);
      setMsg("Map saved.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMapBusy(false);
    }
  }

  async function onAnalyzePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    setMapBusy(true);
    setErr(null);
    try {
      await analyzeFestivalMap(f ?? undefined);
      setMsg(f ? "Analyzed map." : "Re-analyzed saved map.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMapBusy(false);
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

  return (
    <div className="space-y-6">
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
        <h2 className="text-sm font-bold text-zinc-900">Festival map</h2>
        <input
          ref={mapRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onMapPick(e)}
        />
        <input
          ref={analyzeRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onAnalyzePick(e)}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={mapBusy}
            onClick={() => mapRef.current?.click()}
            className="border-2 border-zinc-900 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 disabled:opacity-40"
          >
            Upload map
          </button>
          <button
            type="button"
            disabled={mapBusy}
            onClick={() => analyzeRef.current?.click()}
            className="border-2 border-zinc-900 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            Analyze (new photo)
          </button>
          <button
            type="button"
            disabled={mapBusy || !group.hasFestivalMap}
            onClick={() => void analyzeFestivalMap()}
            className="border-2 border-zinc-900 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 disabled:opacity-40"
          >
            Analyze saved map
          </button>
        </div>
        {mapPreview ? (
          // Base64 preview; next/image is not a fit for large data URLs.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className="max-h-48 max-w-full border border-zinc-400 object-contain"
            src={`data:${mapPreview.mime};base64,${mapPreview.data}`}
          />
        ) : null}
        {group.mapStageLabels.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-800">
              Map labels → schedule stage
            </p>
            <div className="max-h-56 space-y-1 overflow-y-auto text-xs">
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
                    <option value="">—</option>
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
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-800">
          <input
            type="checkbox"
            checked={group.walkTimesEnabled}
            onChange={(e) => void saveWalkToggle(e.target.checked)}
          />
          Use walk times in clashes and plans
        </label>
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
