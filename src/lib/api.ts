import type { ClasherSession, FestivalSnapshot, RatingTier } from "@/lib/types";

function apiUrl(resourcePath: string): string {
  const p = resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`;
  return `/api${p}`;
}

function bearer(secret: string): HeadersInit {
  return { Authorization: `Bearer ${secret}` };
}

function responseLooksLikeHtml(body: string): boolean {
  const head = body.slice(0, 240).toLowerCase();
  return head.includes("<!doctype") || head.includes("<html");
}

function formatFailedApiResponse(r: Response, body: string): string {
  const trimmed = body.trim();
  if (r.status === 404 && responseLooksLikeHtml(trimmed)) {
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "this site";
    return `Routing or deployment issue (HTTP 404): the server returned HTML instead of JSON. Check ${origin}/api/health and that /api routes are deployed on the same origin.`;
  }
  if (trimmed) {
    try {
      const j = JSON.parse(trimmed) as { message?: string; error?: string };
      if (j.message && typeof j.message === "string") return j.message;
      if (j.error && typeof j.error === "string") return j.error;
    } catch {
      /* keep */
    }
    if (responseLooksLikeHtml(trimmed)) {
      return `Unexpected HTML response (HTTP ${r.status}). Requests must hit your app’s /api routes, not a static 404 page.`;
    }
    return trimmed;
  }
  return `HTTP ${r.status}${r.statusText ? ` ${r.statusText}` : ""}`;
}

async function ensureOk(r: Response): Promise<void> {
  if (r.ok) return;
  let text = "";
  try {
    text = (await r.text()).trim();
  } catch {
    /* ignore */
  }
  throw new Error(formatFailedApiResponse(r, text));
}

export async function apiPeekInvite(token: string): Promise<{
  squadId: string;
  festivalName: string;
  phase: string;
} | null> {
  try {
    const r = await fetch(
      apiUrl(`/squads/by-token/${encodeURIComponent(token)}`)
    );
    if (!r.ok) return null;
    return (await r.json()) as {
      squadId: string;
      festivalName: string;
      phase: string;
    };
  } catch {
    return null;
  }
}

export async function apiCreateSquad(
  festivalName: string,
  displayName: string
): Promise<{
  squadId: string;
  inviteToken: string;
  memberId: string;
  memberSecret: string;
  group: FestivalSnapshot;
}> {
  const r = await fetch(apiUrl("/squads"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ festivalName, displayName }),
  });
  await ensureOk(r);
  return r.json();
}

export async function apiJoinSquad(
  inviteToken: string,
  displayName: string
): Promise<{
  squadId: string;
  memberId: string;
  memberSecret: string;
  group: FestivalSnapshot;
}> {
  const r = await fetch(
    apiUrl(`/squads/by-token/${encodeURIComponent(inviteToken)}/join`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName }),
    }
  );
  await ensureOk(r);
  return r.json();
}

/** Resume session by slug (from URL) or by display name (typed on invite page). */
export async function apiResumeSquad(
  inviteToken: string,
  opts: { slug?: string; displayName?: string }
): Promise<{
  squadId: string;
  memberId: string;
  memberSecret: string;
  group: FestivalSnapshot;
}> {
  const body: { slug?: string; displayName?: string } = {};
  if (opts.slug !== undefined && opts.slug !== "") body.slug = opts.slug;
  if (opts.displayName !== undefined && opts.displayName !== "")
    body.displayName = opts.displayName;
  const r = await fetch(
    apiUrl(`/squads/by-token/${encodeURIComponent(inviteToken)}/resume`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  await ensureOk(r);
  return r.json();
}

export async function apiDeleteSquad(session: ClasherSession): Promise<void> {
  const r = await fetch(apiUrl(`/squads/${session.squadId}`), {
    method: "DELETE",
    headers: bearer(session.memberSecret),
  });
  await ensureOk(r);
}

/** Remove this member from the squad (server + cascade); clears auth for that member. */
export async function apiLeaveSquad(session: ClasherSession): Promise<void> {
  const r = await fetch(
    apiUrl(`/squads/${encodeURIComponent(session.squadId)}/members/me`),
    {
      method: "DELETE",
      headers: bearer(session.memberSecret),
    }
  );
  await ensureOk(r);
}

export async function apiSnapshot(
  session: ClasherSession
): Promise<FestivalSnapshot> {
  const r = await fetch(apiUrl(`/squads/${session.squadId}/snapshot`), {
    headers: bearer(session.memberSecret),
  });
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export async function apiUploadFestivalMap(
  session: ClasherSession,
  file: File
): Promise<FestivalSnapshot> {
  const fd = new FormData();
  fd.set("file", file);
  const r = await fetch(apiUrl(`/squads/${session.squadId}/festival-map`), {
    method: "POST",
    headers: bearer(session.memberSecret),
    body: fd,
  });
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export async function apiAnalyzeFestivalMap(
  session: ClasherSession,
  file: File
): Promise<FestivalSnapshot> {
  const fd = new FormData();
  fd.set("file", file);
  const r = await fetch(
    apiUrl(`/squads/${session.squadId}/festival-map/analyze`),
    {
      method: "POST",
      headers: bearer(session.memberSecret),
      body: fd,
    }
  );
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export async function apiPatchSquadOptions(
  session: ClasherSession,
  patch: {
    walkTimesEnabled?: boolean;
    stageAliasJson?: Record<string, string>;
    walkMatrixJson?: Record<string, Record<string, number>>;
    mapStageLabelsJson?: string[];
  }
): Promise<FestivalSnapshot> {
  const r = await fetch(apiUrl(`/squads/${session.squadId}/squad-options`), {
    method: "PATCH",
    headers: {
      ...bearer(session.memberSecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export async function apiSetRating(
  session: ClasherSession,
  artistId: string,
  tier: RatingTier
): Promise<FestivalSnapshot> {
  const r = await fetch(apiUrl(`/squads/${session.squadId}/ratings`), {
    method: "POST",
    headers: { ...bearer(session.memberSecret), "Content-Type": "application/json" },
    body: JSON.stringify({ artistId, tier }),
  });
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export async function apiAddComment(
  session: ClasherSession,
  artistId: string,
  body: string
): Promise<FestivalSnapshot> {
  const r = await fetch(apiUrl(`/squads/${session.squadId}/comments`), {
    method: "POST",
    headers: { ...bearer(session.memberSecret), "Content-Type": "application/json" },
    body: JSON.stringify({ artistId, body }),
  });
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export async function apiAddSlotComment(
  session: ClasherSession,
  slotId: string,
  body: string
): Promise<FestivalSnapshot> {
  const r = await fetch(apiUrl(`/squads/${session.squadId}/slot-comments`), {
    method: "POST",
    headers: { ...bearer(session.memberSecret), "Content-Type": "application/json" },
    body: JSON.stringify({ slotId, body }),
  });
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export async function apiBulkArtists(
  session: ClasherSession,
  names: string[]
): Promise<FestivalSnapshot> {
  const r = await fetch(apiUrl(`/squads/${session.squadId}/artists/bulk`), {
    method: "POST",
    headers: { ...bearer(session.memberSecret), "Content-Type": "application/json" },
    body: JSON.stringify({ names }),
  });
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export type ScheduleDraftSlot = {
  dayLabel: string;
  stageName: string;
  start: string;
  end: string;
  artistName: string;
};

export async function apiReplaceSchedule(
  session: ClasherSession,
  slots: ScheduleDraftSlot[]
): Promise<FestivalSnapshot> {
  const r = await fetch(apiUrl(`/squads/${session.squadId}/schedule/replace`), {
    method: "PUT",
    headers: { ...bearer(session.memberSecret), "Content-Type": "application/json" },
    body: JSON.stringify({ slots }),
  });
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export type ScheduleSlotPatch = Partial<ScheduleDraftSlot>;

export async function apiPatchScheduleSlot(
  session: ClasherSession,
  slotId: string,
  patch: ScheduleSlotPatch
): Promise<FestivalSnapshot> {
  const r = await fetch(
    apiUrl(`/squads/${session.squadId}/schedule/slots/${slotId}`),
    {
      method: "PATCH",
      headers: {
        ...bearer(session.memberSecret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    }
  );
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export async function apiAppendScheduleSlot(
  session: ClasherSession,
  slot: ScheduleDraftSlot
): Promise<FestivalSnapshot> {
  const r = await fetch(apiUrl(`/squads/${session.squadId}/schedule/append`), {
    method: "POST",
    headers: {
      ...bearer(session.memberSecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slot }),
  });
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export async function apiDeleteScheduleSlot(
  session: ClasherSession,
  slotId: string
): Promise<FestivalSnapshot> {
  const r = await fetch(
    apiUrl(`/squads/${session.squadId}/schedule/slots/${slotId}`),
    {
      method: "DELETE",
      headers: bearer(session.memberSecret),
    }
  );
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export type ConflictPlanPayload = {
  slotAId: string;
  slotBId: string;
  planMode: "group" | "pick" | "split_seq" | "custom" | null;
  choice?: string | null;
  planNote?: string | null;
  individualOnly?: boolean;
  splitOrderSlotIds?: [string, string];
  customWindows?: { slotId: string; planFrom: string; planTo: string }[];
  /** If planMode is group: optional preference if the squad splits. */
  groupLeanSlotId?: string | null;
  /** With planMode group: set squad-wide default pick (shows confirm on client). */
  squadDefaultChoiceSlotId?: string | null;
  /** With planMode group: set squad default split order (first → second). */
  squadDefaultSplitOrderSlotIds?: [string, string];
  /** With planMode group: set squad default custom windows (both slots). */
  squadDefaultCustomWindows?: { slotId: string; planFrom: string; planTo: string }[];
  clearSquadDefault?: boolean;
};

export async function apiSetConflict(
  session: ClasherSession,
  payload: ConflictPlanPayload
): Promise<FestivalSnapshot> {
  const r = await fetch(apiUrl(`/squads/${session.squadId}/conflicts`), {
    method: "PUT",
    headers: { ...bearer(session.memberSecret), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export async function apiPutSlotIntents(
  session: ClasherSession,
  intents: {
    slotId: string;
    wants: boolean;
    scheduleKeep?: boolean;
    planFrom?: string | null;
    planTo?: string | null;
  }[]
): Promise<FestivalSnapshot> {
  const r = await fetch(apiUrl(`/squads/${session.squadId}/slot-intents`), {
    method: "PUT",
    headers: { ...bearer(session.memberSecret), "Content-Type": "application/json" },
    body: JSON.stringify({ intents }),
  });
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

/** Copy the combined “everyone” plan (any member’s acts) onto this member. */
export async function apiSyncPlanFromGroup(
  session: ClasherSession
): Promise<FestivalSnapshot> {
  const r = await fetch(
    apiUrl(`/squads/${session.squadId}/plan/sync-from-group`),
    {
      method: "POST",
      headers: bearer(session.memberSecret),
    }
  );
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export async function apiPatchScheduleKeep(
  session: ClasherSession,
  slotId: string,
  keep: boolean
): Promise<FestivalSnapshot> {
  const r = await fetch(apiUrl(`/squads/${session.squadId}/schedule-keep`), {
    method: "PATCH",
    headers: {
      ...bearer(session.memberSecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slotId, keep }),
  });
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export async function apiDemoLineup(
  session: ClasherSession
): Promise<FestivalSnapshot> {
  const r = await fetch(apiUrl(`/squads/${session.squadId}/demo-lineup`), {
    method: "POST",
    headers: bearer(session.memberSecret),
  });
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

export async function apiDemoSchedule(
  session: ClasherSession
): Promise<FestivalSnapshot> {
  const r = await fetch(apiUrl(`/squads/${session.squadId}/demo-schedule`), {
    method: "POST",
    headers: bearer(session.memberSecret),
  });
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

/** Demo lineup + schedule in one request. */
export async function apiDemoFull(
  session: ClasherSession
): Promise<FestivalSnapshot> {
  const r = await fetch(apiUrl(`/squads/${session.squadId}/demo-full`), {
    method: "POST",
    headers: bearer(session.memberSecret),
  });
  await ensureOk(r);
  const j = await r.json();
  return j.group as FestivalSnapshot;
}

function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 120_000
): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ctrl.signal })
    .finally(() => clearTimeout(id));
}

export async function apiParseLineupImage(file: File): Promise<string[]> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetchWithTimeout(apiUrl("/parse/lineup"), {
    method: "POST",
    body: form,
  });
  if (!r.ok) {
    const raw = await r.text();
    throw new Error(formatFailedApiResponse(r, raw));
  }
  const j = (await r.json()) as { artists?: string[] };
  return Array.isArray(j.artists) ? j.artists : [];
}

export async function apiParseScheduleImages(
  files: File[]
): Promise<ScheduleDraftSlot[]> {
  if (!files.length) return [];
  const form = new FormData();
  for (const f of files) {
    form.append("file", f);
  }
  const r = await fetchWithTimeout(apiUrl("/parse/schedule"), {
    method: "POST",
    body: form,
  });
  if (!r.ok) {
    const raw = await r.text();
    throw new Error(formatFailedApiResponse(r, raw));
  }
  const j = (await r.json()) as { slots?: ScheduleDraftSlot[] };
  return Array.isArray(j.slots) ? j.slots : [];
}
