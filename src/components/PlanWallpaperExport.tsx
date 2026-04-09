"use client";

import { useState } from "react";

import {
  buildGroupUnionLines,
  buildMemberPlanLines,
  renderPlanWallpaperPng,
} from "@/lib/planWallpaper";
import type { FestivalSnapshot } from "@/lib/types";

export function PlanWallpaperExport({
  group,
  sessionMemberId,
}: {
  group: FestivalSnapshot;
  sessionMemberId: string;
}) {
  const [scope, setScope] = useState<"me" | "member" | "group">("me");
  const [pickMember, setPickMember] = useState(sessionMemberId);
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      let lines;
      let title: string;
      if (scope === "group") {
        lines = buildGroupUnionLines(group);
        title = "Group (anyone attending)";
      } else {
        const mid = scope === "me" ? sessionMemberId : pickMember;
        lines = buildMemberPlanLines(group, mid);
        title =
          mid === sessionMemberId
            ? "My plan"
            : `${group.members.find((m) => m.id === mid)?.displayName ?? "Member"} plan`;
      }
      const blob = await renderPlanWallpaperPng(lines, title);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clasher-plan-${scope}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-2 border-zinc-900 bg-indigo-50/40 p-4 shadow-[2px_2px_0_0_#18181b]">
      <p className="text-sm font-semibold text-zinc-900">Wallpaper (16:9 PNG)</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setScope("me")}
          className={`border-2 px-2 py-1 text-xs font-semibold ${
            scope === "me"
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-900 bg-white text-zinc-900"
          }`}
        >
          My plan
        </button>
        <button
          type="button"
          onClick={() => setScope("member")}
          className={`border-2 px-2 py-1 text-xs font-semibold ${
            scope === "member"
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-900 bg-white text-zinc-900"
          }`}
        >
          Someone
        </button>
        <button
          type="button"
          onClick={() => setScope("group")}
          className={`border-2 px-2 py-1 text-xs font-semibold ${
            scope === "group"
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-900 bg-white text-zinc-900"
          }`}
        >
          Group union
        </button>
      </div>
      {scope === "member" ? (
        <label className="flex flex-wrap items-center gap-2 text-sm text-zinc-800">
          <span className="font-medium">Member</span>
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
      <button
        type="button"
        disabled={busy || !group.schedule.length}
        onClick={() => void download()}
        className="border-2 border-zinc-900 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-[2px_2px_0_0_#18181b] disabled:opacity-40"
      >
        {busy ? "Rendering…" : "Download PNG"}
      </button>
    </div>
  );
}
