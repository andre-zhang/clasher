"use client";

import { planDayTravelLines } from "@/lib/planMemberDay";
import type { FestivalSnapshot } from "@/lib/types";

export function PlanWalkBanner({
  group,
  activeDay,
  memberId,
  variant,
}: {
  group: FestivalSnapshot;
  activeDay: string | null;
  memberId: string | null;
  /** person: show that member's travel chain; everyone: squad-level message */
  variant: "person" | "everyone";
}) {
  const d = activeDay?.trim();
  if (!d) return null;

  if (!group.walkTimesEnabled) {
    return (
      <div className="mb-3 w-full border-2 border-zinc-900 bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-900">
        Walk times are off — enable in Options to see travel between stages.
      </div>
    );
  }

  if (variant === "person" && memberId) {
    const lines = planDayTravelLines(group, memberId, d);
    return (
      <div className="mb-3 w-full border-2 border-zinc-900 bg-zinc-100 px-3 py-2 text-xs text-zinc-900">
        <span className="font-bold">Walk</span>
        {lines.length ? (
          <span className="ml-1">{lines.join(" · ")}</span>
        ) : (
          <span className="ml-1 font-medium text-zinc-700">
            No stage changes in your plan this day (or same stage back-to-back).
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="mb-3 w-full border-2 border-zinc-900 bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-900">
      Walk times on — columns use your plan windows; travel estimates come from
      the Options map.
    </div>
  );
}
