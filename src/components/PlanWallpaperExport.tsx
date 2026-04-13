"use client";

import { useEffect, useMemo, useState } from "react";

import { ClasherCheckbox } from "@/components/ClasherCheckbox";
import {
  buildEveryoneCalendarSlotsForDay,
  buildMemberPlanCalendarSlotsForDay,
  renderPlanWallpaperCalendarPng,
} from "@/lib/planWallpaper";
import type { FestivalSnapshot } from "@/lib/types";

export function PlanWallpaperExport({
  group,
  sessionMemberId,
}: {
  group: FestivalSnapshot;
  sessionMemberId: string;
}) {
  const [scope, setScope] = useState<"member" | "everyone">("member");
  const [pickMember, setPickMember] = useState(sessionMemberId);
  const [busy, setBusy] = useState(false);

  const days = useMemo(() => {
    const d = new Set(group.schedule.map((s) => s.dayLabel.trim()));
    return [...d].sort();
  }, [group.schedule]);

  const [selectedDays, setSelectedDays] = useState<Record<string, boolean>>(
    {}
  );

  useEffect(() => {
    setSelectedDays((prev) => {
      const next: Record<string, boolean> = {};
      for (const d of days) {
        next[d] = prev[d] ?? true;
      }
      return next;
    });
  }, [days]);

  async function download() {
    setBusy(true);
    try {
      const picked = days.filter((d) => selectedDays[d]);
      if (!picked.length) return;

      const titleBase =
        scope === "everyone"
          ? "Group"
          : (group.members.find((m) => m.id === pickMember)?.displayName ??
            "Member");

      for (const dayLabel of picked) {
        const slots =
          scope === "everyone"
            ? buildEveryoneCalendarSlotsForDay(group, dayLabel)
            : buildMemberPlanCalendarSlotsForDay(
                group,
                pickMember,
                dayLabel
              );
        const blob = await renderPlanWallpaperCalendarPng(
          dayLabel,
          titleBase,
          slots
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const safeDay = dayLabel.replace(/[^\w\-]+/g, "_");
        const fileStem = `plan-${titleBase.replace(/[^\w\-]+/g, "_")}-${safeDay}`;
        a.download = `${fileStem}.png`;
        a.click();
        URL.revokeObjectURL(url);
        await new Promise((r) => setTimeout(r, 350));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded border-2 border-zinc-900 bg-indigo-50/30">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-zinc-900">
        Wallpaper PNG (9×16)
      </summary>
      <div className="space-y-3 border-t border-zinc-200 p-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setScope("member")}
            className={`border-2 px-2 py-1 text-xs font-semibold ${
              scope === "member"
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-900 bg-white text-zinc-900"
            }`}
          >
            One person
          </button>
          <button
            type="button"
            onClick={() => setScope("everyone")}
            className={`border-2 px-2 py-1 text-xs font-semibold ${
              scope === "everyone"
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-900 bg-white text-zinc-900"
            }`}
          >
            Group
          </button>
        </div>
        {scope === "member" ? (
          <label className="flex flex-wrap items-center gap-2 text-sm text-zinc-800">
            <span className="font-medium">Who</span>
            <select
              className="border-2 border-zinc-900 bg-white px-2 py-1 text-sm"
              value={pickMember}
              onChange={(e) => setPickMember(e.target.value)}
            >
              {group.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                  {m.id === sessionMemberId ? " (you)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {days.length > 0 ? (
          <fieldset className="space-y-1">
            <legend className="text-xs font-semibold text-zinc-800">Days</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-2">
              {days.map((d) => (
                <ClasherCheckbox
                  key={d}
                  size="sm"
                  checked={Boolean(selectedDays[d])}
                  onChange={(v) =>
                    setSelectedDays((s) => ({ ...s, [d]: v }))
                  }
                >
                  {d}
                </ClasherCheckbox>
              ))}
            </div>
          </fieldset>
        ) : null}
        <button
          type="button"
          disabled={busy || !group.schedule.length}
          onClick={() => void download()}
          className="border-2 border-zinc-900 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Rendering…" : "Download"}
        </button>
      </div>
    </details>
  );
}
