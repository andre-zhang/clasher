import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { dbErrorHttpResponse } from "./dbErrors";
import { getPublicRequestOrigin } from "./publicOrigin";
import {
  DEMO_ARTIST_NAMES,
  DEMO_FRIEND_DISPLAY_NAMES,
  DEMO_FRIEND_HOT_ARTIST_INDICES,
  DEMO_SLOT_ROWS,
} from "./demoFestivalData";
import {
  applyPickChoiceToIntents,
  patchIntentsForConflict,
} from "./applyConflictIntents";
import { normalizeScheduleTimesForImport } from "@/lib/scheduleTimeNormalize";
import { displayNameTakenInSquad, memberDisplaySlug } from "@/lib/memberSlug";

import {
  buildWalkMatrixFromStageOrder,
  orderScheduleStagesByMap,
  parseMatchesFromVision,
  parseStageLabelsFromVision,
} from "./mapStages";
import { getArtistsForMemberSetlist } from "@/lib/setlistMemberArtists";
import { buildSetlistPreviewForArtists } from "@/lib/setlistPreview";
import { spotifyUrisForSetlistRows } from "@/lib/spotifyResolveUris";
import { isSpotifySearchConfigured } from "@/lib/spotifySearch";
import {
  isSafeSpotifyReturnPath,
  isSpotifyStateSignable,
  signSpotifyState,
  verifySpotifyState,
} from "@/lib/spotifyState";
import {
  spotifyAddTracks,
  spotifyBackendRedirectUri,
  spotifyCreatePlaylist,
  spotifyExchangeCodeForToken,
  spotifyRefreshUserAccess,
} from "@/lib/spotifyUserPlaylist";
import { buildSnapshot } from "./snapshot";
import { runClaudeTextJson, runVisionJson } from "./vision";

function randomToken(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  ).toLowerCase();
}

function normSlotPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

async function authMember(c: Context, squadId: string) {
  const auth = c.req.header("Authorization");
  const secret = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!secret) return null;
  const member = await prisma.member.findUnique({ where: { secret } });
  if (!member || member.squadId !== squadId) return null;
  return member;
}

async function visionJsonFromForm(
  c: Context,
  prompt: string,
  schemaHint: string
): Promise<Response | Record<string, unknown>> {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "missing_file", message: "Expected multipart field file" }, 400);
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/jpeg";
  const result = await runVisionJson(buf, mime, schemaHint, prompt);
  if (!result.ok) {
    return c.json(
      { error: "vision_unconfigured", message: result.message },
      503
    );
  }
  return result.json;
}

/**
 * @param apiBasePath — `'/api'` when mounted under Next (`/api/squads/...`).
 */
export function createFestivalApp(apiBasePath: string): Hono {
  const app = apiBasePath ? new Hono().basePath(apiBasePath) : new Hono();

  app.onError((err, c) => {
    console.error("[clasher]", c.req.path, err);
    const { status, body } = dbErrorHttpResponse(err);
    return c.json(body, status);
  });

  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization", "Accept"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 86_400,
    })
  );

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/squads/by-token/:inviteToken", async (c) => {
    const inviteToken = String(c.req.param("inviteToken") ?? "")
      .trim()
      .toLowerCase();
    const squad = await prisma.squad.findFirst({
      where: { inviteToken },
      select: { id: true, festivalName: true, phase: true },
    });
    if (!squad) return c.json({ error: "not_found" }, 404);
    return c.json({
      squadId: squad.id,
      festivalName: squad.festivalName,
      phase: squad.phase,
    });
  });

  app.post("/squads", async (c) => {
    let body: { festivalName?: string; displayName?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const festivalName = (body.festivalName ?? "My festival").trim() || "My festival";
    const displayName = (body.displayName ?? "You").trim() || "You";
    const inviteToken = randomToken();

    const squad = await prisma.squad.create({
      data: {
        festivalName,
        inviteToken,
        members: { create: { displayName } },
      },
      include: { members: true },
    });
    const member = squad.members[0]!;
    const snap = await buildSnapshot(prisma, squad.id, member.id);
    return c.json({
      squadId: squad.id,
      inviteToken: squad.inviteToken,
      memberId: member.id,
      memberSecret: member.secret,
      group: snap,
    });
  });

  app.post("/squads/by-token/:inviteToken/join", async (c) => {
    const inviteToken = String(c.req.param("inviteToken") ?? "")
      .trim()
      .toLowerCase();
    let body: { displayName?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const displayName = (body.displayName ?? "Friend").trim() || "Friend";
    const squad = await prisma.squad.findFirst({ where: { inviteToken } });
    if (!squad) return c.json({ error: "not_found" }, 404);

    const existingNames = (
      await prisma.member.findMany({
        where: { squadId: squad.id },
        select: { displayName: true },
      })
    ).map((m) => m.displayName);
    if (displayNameTakenInSquad(existingNames, displayName)) {
      return c.json(
        {
          error: "name_taken",
          message:
            "That name is already in this group. Use Log back in instead of Join.",
        },
        409
      );
    }

    const member = await prisma.$transaction(async (tx) => {
      const m = await tx.member.create({
        data: { squadId: squad.id, displayName },
      });
      const peerRows = await tx.memberSlotIntent.findMany({
        where: {
          squadId: squad.id,
          memberId: { not: m.id },
          wants: true,
        },
        select: { slotId: true },
      });
      const seen = new Set<string>();
      for (const r of peerRows) {
        if (seen.has(r.slotId)) continue;
        seen.add(r.slotId);
        await tx.memberSlotIntent.create({
          data: {
            squadId: squad.id,
            memberId: m.id,
            slotId: r.slotId,
            wants: true,
            personalPlanOnly: false,
            scheduleKeep: false,
            planFrom: null,
            planTo: null,
          },
        });
      }
      return m;
    });
    const snap = await buildSnapshot(prisma, squad.id, member.id);
    return c.json({
      squadId: squad.id,
      memberId: member.id,
      memberSecret: member.secret,
      group: snap,
    });
  });

  app.post("/squads/by-token/:inviteToken/resume", async (c) => {
    const inviteToken = String(c.req.param("inviteToken") ?? "")
      .trim()
      .toLowerCase();
    let body: { slug?: string; displayName?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const slugPart =
      typeof body.slug === "string" ? decodeURIComponent(body.slug).trim() : "";
    const displayNamePart =
      typeof body.displayName === "string" ? body.displayName.trim() : "";
    const targetSlug = displayNamePart
      ? memberDisplaySlug(displayNamePart)
      : memberDisplaySlug(slugPart);
    if (!targetSlug) {
      return c.json(
        {
          error: "invalid_name",
          message: "Enter the name you used when you joined.",
        },
        400
      );
    }
    const squad = await prisma.squad.findFirst({ where: { inviteToken } });
    if (!squad) return c.json({ error: "not_found", message: "Invite not found." }, 404);

    const members = await prisma.member.findMany({
      where: { squadId: squad.id },
      select: { id: true, displayName: true, secret: true },
    });
    const matches = members.filter(
      (m) => memberDisplaySlug(m.displayName) === targetSlug
    );
    if (matches.length === 0) {
      return c.json(
        {
          error: "not_found",
          message: "No one in this group matches that name.",
        },
        404
      );
    }
    if (matches.length > 1) {
      return c.json(
        {
          error: "ambiguous",
          message:
            "Several members match that name. Use the exact spelling you signed up with.",
        },
        409
      );
    }
    const member = matches[0]!;
    const snap = await buildSnapshot(prisma, squad.id, member.id);
    return c.json({
      squadId: squad.id,
      memberId: member.id,
      memberSecret: member.secret,
      group: snap,
    });
  });

  app.get("/squads/:squadId/snapshot", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  app.get("/squads/:squadId/festival-map", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    const squad = await prisma.squad.findUnique({
      where: { id: member.squadId },
      select: { festivalMapData: true, festivalMapMime: true },
    });
    if (!squad?.festivalMapData) {
      return c.json({ error: "no_map" }, 404);
    }
    return c.json({
      mime: squad.festivalMapMime ?? "image/jpeg",
      data: squad.festivalMapData,
    });
  });

  app.post("/squads/:squadId/festival-map", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "missing_file" }, 400);
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.byteLength > 8 * 1024 * 1024) {
      return c.json({ error: "file_too_large" }, 400);
    }
    await prisma.squad.update({
      where: { id: member.squadId },
      data: {
        festivalMapData: buf.toString("base64"),
        festivalMapMime: file.type || "image/jpeg",
      },
    });
    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  app.post("/squads/:squadId/festival-map/analyze", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);

    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return c.json(
        {
          error: "multipart_required",
          message: "Send the map image as multipart field \"file\".",
        },
        400
      );
    }
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "missing_file" }, 400);
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "image/jpeg";
    if (buf.byteLength > 8 * 1024 * 1024) {
      return c.json({ error: "file_too_large" }, 400);
    }

    const vision = await runVisionJson(
      buf,
      mime,
      'Schema: {"stageLabels":["string"]} — distinct stage / tent / arena names on the map.',
      'List every performance stage or named area on this festival map. Return JSON only: {"stageLabels":["..."]}'
    );
    if (!vision.ok) {
      return c.json({ error: "vision_failed", message: vision.message }, 503);
    }
    const labels = parseStageLabelsFromVision(vision.json);
    if (!labels.length) {
      return c.json({ error: "no_stages_found" }, 422);
    }

    const slots = await prisma.scheduleSlot.findMany({
      where: { squadId: member.squadId },
      select: { stageName: true },
    });
    const schedStages = [
      ...new Set(slots.map((s) => s.stageName.trim()).filter(Boolean)),
    ].sort();
    if (!schedStages.length) {
      return c.json({ error: "no_schedule_stages" }, 400);
    }

    const textRes = await runClaudeTextJson(
      "You match noisy map text to canonical stage names. Reply with valid JSON only (no markdown).",
      `Canonical schedule stage names (exact strings):\n${JSON.stringify(
        schedStages
      )}\n\nLabels read from the map:\n${JSON.stringify(
        labels
      )}\n\nReturn JSON: {"matches":[{"mapLabel":"...","scheduleStage":"..."}]}\nOne entry per map label. scheduleStage must be one of the canonical strings.`
    );
    if (!textRes.ok) {
      return c.json({ error: "match_failed", message: textRes.message }, 503);
    }
    const alias = parseMatchesFromVision(textRes.json);
    const ordered = orderScheduleStagesByMap(schedStages, labels, alias);
    const matrix = buildWalkMatrixFromStageOrder(ordered);

    await prisma.squad.update({
      where: { id: member.squadId },
      data: {
        mapStageLabelsJson: labels,
        stageAliasJson: alias as Prisma.InputJsonValue,
        walkMatrixJson: matrix as Prisma.InputJsonValue,
        festivalMapData: null,
        festivalMapMime: null,
      },
    });
    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  app.patch("/squads/:squadId/squad-options", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    let body: {
      walkTimesEnabled?: boolean;
      stageAliasJson?: Record<string, string>;
      walkMatrixJson?: Record<string, Record<string, number>>;
      mapStageLabelsJson?: string[];
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const data: Prisma.SquadUpdateInput = {};
    if (typeof body.walkTimesEnabled === "boolean") {
      data.walkTimesEnabled = body.walkTimesEnabled;
    }
    if (body.stageAliasJson && typeof body.stageAliasJson === "object") {
      data.stageAliasJson = body.stageAliasJson as Prisma.InputJsonValue;
    }
    if (body.walkMatrixJson && typeof body.walkMatrixJson === "object") {
      data.walkMatrixJson = body.walkMatrixJson as Prisma.InputJsonValue;
    }
    if (Array.isArray(body.mapStageLabelsJson)) {
      data.mapStageLabelsJson = body.mapStageLabelsJson as Prisma.InputJsonValue;
    }
    if (Object.keys(data).length === 0) {
      return c.json({ error: "no_updates" }, 400);
    }
    await prisma.squad.update({
      where: { id: member.squadId },
      data,
    });
    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  app.post("/squads/:squadId/ratings", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    let body: { artistId?: string; tier?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (!body.artistId || !body.tier) return c.json({ error: "bad_request" }, 400);
    const artist = await prisma.artist.findFirst({
      where: { id: body.artistId, squadId: member.squadId },
    });
    if (!artist) return c.json({ error: "no_artist" }, 400);
    await prisma.rating.upsert({
      where: {
        memberId_artistId: { memberId: member.id, artistId: body.artistId },
      },
      create: {
        memberId: member.id,
        artistId: body.artistId,
        tier: body.tier,
      },
      update: { tier: body.tier },
    });
    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  app.post("/squads/:squadId/comments", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    let body: { artistId?: string; body?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (!body.artistId || !body.body?.trim())
      return c.json({ error: "bad_request" }, 400);
    await prisma.comment.create({
      data: {
        squadId: member.squadId,
        artistId: body.artistId,
        memberId: member.id,
        body: body.body.trim(),
      },
    });
    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  app.post("/squads/:squadId/slot-comments", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    let body: { slotId?: string; body?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const text = body.body?.trim() ?? "";
    if (!body.slotId || !text)
      return c.json({ error: "bad_request" }, 400);
    const slot = await prisma.scheduleSlot.findFirst({
      where: { id: body.slotId, squadId: member.squadId },
    });
    if (!slot) return c.json({ error: "unknown_slot" }, 400);
    const safe = text.slice(0, 500);
    await prisma.slotComment.create({
      data: {
        squadId: member.squadId,
        slotId: body.slotId,
        memberId: member.id,
        body: safe,
      },
    });
    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  app.patch("/squads/:squadId", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    let body: { phase?: string; festivalName?: string; festivalDate?: string | null };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const data: {
      phase?: string;
      festivalName?: string;
      festivalDate?: Date | null;
    } = {};
    if (body.phase !== undefined) data.phase = body.phase;
    if (body.festivalName !== undefined)
      data.festivalName = body.festivalName.trim() || undefined;
    if (body.festivalDate !== undefined) {
      if (body.festivalDate === null || body.festivalDate === "")
        data.festivalDate = null;
      else {
        const d = new Date(body.festivalDate);
        data.festivalDate = Number.isNaN(d.getTime()) ? null : d;
      }
    }
    if (Object.keys(data).length) {
      await prisma.squad.update({
        where: { id: member.squadId },
        data,
      });
    }
    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  app.post("/squads/:squadId/artists/bulk", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    let body: { names?: string[] };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const names = (body.names ?? []).map((n) => n.trim()).filter(Boolean);
    const maxSort = await prisma.artist.aggregate({
      where: { squadId: member.squadId },
      _max: { sortOrder: true },
    });
    let order = (maxSort._max.sortOrder ?? -1) + 1;
    await prisma.artist.createMany({
      data: names.map((name) => ({
        squadId: member.squadId,
        name,
        sortOrder: order++,
      })),
    });
    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  app.put("/squads/:squadId/schedule/replace", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    let body: {
      slots?: {
        dayLabel: string;
        stageName: string;
        start: string;
        end: string;
        artistName: string;
      }[];
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const slots = body.slots ?? [];
    await prisma.squadClashDefault.deleteMany({
      where: { squadId: member.squadId },
    });
    await prisma.conflictResolution.deleteMany({
      where: { squadId: member.squadId },
    });
    await prisma.memberSlotIntent.deleteMany({
      where: { squadId: member.squadId },
    });
    await prisma.scheduleSlot.deleteMany({
      where: { squadId: member.squadId },
    });
    const artists = await prisma.artist.findMany({
      where: { squadId: member.squadId },
    });
    const findArtist = (name: string) => {
      const n = name.trim().toLowerCase();
      return artists.find((a) => a.name.toLowerCase() === n);
    };
    for (const s of slots) {
      let art = findArtist(s.artistName);
      if (!art) {
        const maxSort = await prisma.artist.aggregate({
          where: { squadId: member.squadId },
          _max: { sortOrder: true },
        });
        const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
        art = await prisma.artist.create({
          data: {
            squadId: member.squadId,
            name: s.artistName.trim(),
            sortOrder,
          },
        });
        artists.push(art);
      }
      await prisma.scheduleSlot.create({
        data: {
          squadId: member.squadId,
          dayLabel: s.dayLabel,
          stageName: s.stageName,
          start: s.start,
          end: s.end,
          artistId: art.id,
        },
      });
    }
    await prisma.squad.update({
      where: { id: member.squadId },
      data: { phase: "scheduled" },
    });
    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  app.post("/squads/:squadId/schedule/append", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    let body: {
      slot?: {
        dayLabel: string;
        stageName: string;
        start: string;
        end: string;
        artistName: string;
      };
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const s = body.slot;
    if (
      !s ||
      !String(s.dayLabel ?? "").trim() ||
      !String(s.stageName ?? "").trim() ||
      !String(s.start ?? "").trim() ||
      !String(s.end ?? "").trim() ||
      !String(s.artistName ?? "").trim()
    ) {
      return c.json({ error: "bad_request" }, 400);
    }
    const artists = await prisma.artist.findMany({
      where: { squadId: member.squadId },
    });
    const want = s.artistName.trim().toLowerCase();
    let art = artists.find((a) => a.name.toLowerCase() === want);
    if (!art) {
      const maxSort = await prisma.artist.aggregate({
        where: { squadId: member.squadId },
        _max: { sortOrder: true },
      });
      const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
      art = await prisma.artist.create({
        data: {
          squadId: member.squadId,
          name: s.artistName.trim(),
          sortOrder,
        },
      });
    }
    await prisma.scheduleSlot.create({
      data: {
        squadId: member.squadId,
        dayLabel: s.dayLabel.trim(),
        stageName: s.stageName.trim(),
        start: s.start.trim(),
        end: s.end.trim(),
        artistId: art.id,
      },
    });
    await prisma.squad.update({
      where: { id: member.squadId },
      data: { phase: "scheduled" },
    });
    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  app.patch("/squads/:squadId/schedule/slots/:slotId", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    const slotId = c.req.param("slotId");
    let body: {
      dayLabel?: string;
      stageName?: string;
      start?: string;
      end?: string;
      artistName?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const slot = await prisma.scheduleSlot.findFirst({
      where: { id: slotId, squadId: member.squadId },
    });
    if (!slot) return c.json({ error: "not_found" }, 404);
    let artistId = slot.artistId;
    if (body.artistName != null && String(body.artistName).trim()) {
      const artists = await prisma.artist.findMany({
        where: { squadId: member.squadId },
      });
      const want = String(body.artistName).trim().toLowerCase();
      let art = artists.find((a) => a.name.toLowerCase() === want);
      if (!art) {
        const maxSort = await prisma.artist.aggregate({
          where: { squadId: member.squadId },
          _max: { sortOrder: true },
        });
        art = await prisma.artist.create({
          data: {
            squadId: member.squadId,
            name: String(body.artistName).trim(),
            sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
          },
        });
      }
      artistId = art.id;
    }
    await prisma.scheduleSlot.update({
      where: { id: slotId },
      data: {
        dayLabel:
          body.dayLabel != null
            ? String(body.dayLabel).trim() || slot.dayLabel
            : slot.dayLabel,
        stageName:
          body.stageName != null
            ? String(body.stageName).trim() || slot.stageName
            : slot.stageName,
        start:
          body.start != null
            ? String(body.start).trim() || slot.start
            : slot.start,
        end:
          body.end != null ? String(body.end).trim() || slot.end : slot.end,
        artistId,
      },
    });
    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  app.delete("/squads/:squadId/schedule/slots/:slotId", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    const sid = member.squadId;
    const slotId = c.req.param("slotId")?.trim();
    if (!slotId) return c.json({ error: "bad_request" }, 400);
    const slot = await prisma.scheduleSlot.findFirst({
      where: { id: slotId, squadId: sid },
    });
    if (!slot) return c.json({ error: "not_found" }, 404);

    await prisma.$transaction(async (tx) => {
      await tx.memberSlotIntent.deleteMany({
        where: { squadId: sid, slotId },
      });
      await tx.conflictResolution.deleteMany({
        where: {
          squadId: sid,
          OR: [{ slotAId: slotId }, { slotBId: slotId }],
        },
      });
      await tx.squadClashDefault.deleteMany({
        where: {
          squadId: sid,
          OR: [{ slotAId: slotId }, { slotBId: slotId }],
        },
      });
      await tx.scheduleSlot.delete({ where: { id: slotId } });
    });

    const snap = await buildSnapshot(prisma, sid, member.id);
    return c.json({ group: snap });
  });

  app.post("/squads/:squadId/schedule/merge-slots", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    const sid = member.squadId;
    let body: { keepSlotId?: string; removeSlotId?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const keep = body.keepSlotId?.trim();
    const remove = body.removeSlotId?.trim();
    if (!keep || !remove || keep === remove)
      return c.json({ error: "bad_request" }, 400);
    const [slotKeep, slotRemove] = await Promise.all([
      prisma.scheduleSlot.findFirst({ where: { id: keep, squadId: sid } }),
      prisma.scheduleSlot.findFirst({ where: { id: remove, squadId: sid } }),
    ]);
    if (!slotKeep || !slotRemove) return c.json({ error: "not_found" }, 404);

    await prisma.$transaction(async (tx) => {
      const removeRows = await tx.memberSlotIntent.findMany({
        where: { squadId: sid, slotId: remove },
      });
      for (const row of removeRows) {
        const existing = await tx.memberSlotIntent.findUnique({
          where: {
            memberId_slotId: { memberId: row.memberId, slotId: keep },
          },
        });
        if (existing) {
          await tx.memberSlotIntent.update({
            where: {
              memberId_slotId: { memberId: row.memberId, slotId: keep },
            },
            data: {
              wants: existing.wants || row.wants,
              scheduleKeep: existing.scheduleKeep || row.scheduleKeep,
              planFrom: null,
              planTo: null,
            },
          });
        } else {
          await tx.memberSlotIntent.create({
            data: {
              squadId: sid,
              memberId: row.memberId,
              slotId: keep,
              wants: row.wants,
              personalPlanOnly: false,
              scheduleKeep: row.scheduleKeep,
              planFrom: null,
              planTo: null,
            },
          });
        }
      }
      await tx.memberSlotIntent.deleteMany({
        where: { squadId: sid, slotId: remove },
      });
      await tx.conflictResolution.deleteMany({
        where: {
          squadId: sid,
          OR: [{ slotAId: remove }, { slotBId: remove }],
        },
      });
      await tx.squadClashDefault.deleteMany({
        where: {
          squadId: sid,
          OR: [{ slotAId: remove }, { slotBId: remove }],
        },
      });
      await tx.scheduleSlot.delete({ where: { id: remove } });
    });

    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  app.post("/squads/:squadId/demo-lineup", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    const sid = member.squadId;

    await prisma.$transaction(async (tx) => {
      await tx.squadClashDefault.deleteMany({ where: { squadId: sid } });
      await tx.conflictResolution.deleteMany({ where: { squadId: sid } });
      await tx.scheduleSlot.deleteMany({ where: { squadId: sid } });
      await tx.memberSlotIntent.deleteMany({ where: { squadId: sid } });
      await tx.rating.deleteMany({
        where: { artist: { squadId: sid } },
      });
      await tx.comment.deleteMany({ where: { squadId: sid } });
      await tx.member.deleteMany({
        where: {
          squadId: sid,
          displayName: { in: [...DEMO_FRIEND_DISPLAY_NAMES] },
        },
      });
      await tx.artist.deleteMany({ where: { squadId: sid } });

      for (let i = 0; i < DEMO_ARTIST_NAMES.length; i++) {
        const name = DEMO_ARTIST_NAMES[i]!;
        await tx.artist.create({
          data: { squadId: sid, name, sortOrder: i },
        });
      }

      await tx.squad.update({
        where: { id: sid },
        data: { phase: "prefestival" },
      });
    });

    const snap = await buildSnapshot(prisma, sid, member.id);
    return c.json({ group: snap });
  });

  app.post("/squads/:squadId/demo-schedule", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    const sid = member.squadId;

    const artists = await prisma.artist.findMany({
      where: { squadId: sid },
      orderBy: { sortOrder: "asc" },
    });
    const byName = new Map(
      artists.map((a) => [a.name.trim().toLowerCase(), a.id] as const)
    );
    for (const name of DEMO_ARTIST_NAMES) {
      if (!byName.has(name.toLowerCase())) {
        return c.json(
          {
            error: "need_demo_lineup",
            message: "Load demo lineup first so all six demo acts exist.",
          },
          400
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.squadClashDefault.deleteMany({ where: { squadId: sid } });
      await tx.conflictResolution.deleteMany({ where: { squadId: sid } });
      await tx.memberSlotIntent.deleteMany({ where: { squadId: sid } });
      await tx.scheduleSlot.deleteMany({ where: { squadId: sid } });

      await tx.scheduleSlot.createMany({
        data: DEMO_SLOT_ROWS.map((row) => ({
          squadId: sid,
          dayLabel: row.dayLabel,
          stageName: row.stageName,
          start: row.start,
          end: row.end,
          artistId: byName.get(DEMO_ARTIST_NAMES[row.artistIndex]!.toLowerCase())!,
        })),
      });

      await tx.squad.update({
        where: { id: sid },
        data: { phase: "scheduled" },
      });
    });

    const snap = await buildSnapshot(prisma, sid, member.id);
    return c.json({ group: snap });
  });

  /** Demo lineup + timetable in one step (for Invite page). */
  app.post("/squads/:squadId/demo-full", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    const sid = member.squadId;

    await prisma.$transaction(async (tx) => {
      await tx.squadClashDefault.deleteMany({ where: { squadId: sid } });
      await tx.conflictResolution.deleteMany({ where: { squadId: sid } });
      await tx.memberSlotIntent.deleteMany({ where: { squadId: sid } });
      await tx.rating.deleteMany({
        where: { artist: { squadId: sid } },
      });
      await tx.comment.deleteMany({ where: { squadId: sid } });
      await tx.slotComment.deleteMany({ where: { squadId: sid } });
      await tx.scheduleSlot.deleteMany({ where: { squadId: sid } });
      await tx.artist.deleteMany({ where: { squadId: sid } });
      await tx.member.deleteMany({
        where: {
          squadId: sid,
          displayName: { in: [...DEMO_FRIEND_DISPLAY_NAMES] },
        },
      });

      for (let i = 0; i < DEMO_ARTIST_NAMES.length; i++) {
        const name = DEMO_ARTIST_NAMES[i]!;
        await tx.artist.create({
          data: { squadId: sid, name, sortOrder: i },
        });
      }

      const artists = await tx.artist.findMany({
        where: { squadId: sid },
        orderBy: { sortOrder: "asc" },
      });
      const byName = new Map(
        artists.map((a) => [a.name.trim().toLowerCase(), a.id] as const)
      );

      await tx.scheduleSlot.createMany({
        data: DEMO_SLOT_ROWS.map((row) => ({
          squadId: sid,
          dayLabel: row.dayLabel,
          stageName: row.stageName,
          start: row.start,
          end: row.end,
          artistId: byName.get(
            DEMO_ARTIST_NAMES[row.artistIndex]!.toLowerCase()
          )!,
        })),
      });

      const slots = await tx.scheduleSlot.findMany({
        where: { squadId: sid },
        orderBy: [{ dayLabel: "asc" }, { start: "asc" }],
      });
      const artistIndexById = new Map(
        artists.map((a, idx) => [a.id, idx] as const)
      );

      for (const friendName of DEMO_FRIEND_DISPLAY_NAMES) {
        const friend = await tx.member.create({
          data: {
            squadId: sid,
            displayName: friendName,
            secret: randomUUID(),
          },
        });
        const hotIdx = new Set(DEMO_FRIEND_HOT_ARTIST_INDICES[friendName]);
        let i = 0;
        for (const idx of hotIdx) {
          const artist = artists[idx];
          if (!artist) continue;
          await tx.rating.create({
            data: {
              memberId: friend.id,
              artistId: artist.id,
              tier: i++ === 0 ? "must" : "want",
            },
          });
        }
        for (const slot of slots) {
          const ai = artistIndexById.get(slot.artistId);
          const wants = ai != null && hotIdx.has(ai);
          await tx.memberSlotIntent.create({
            data: {
              squadId: sid,
              memberId: friend.id,
              slotId: slot.id,
              wants,
              personalPlanOnly: false,
              scheduleKeep: wants,
              planFrom: null,
              planTo: null,
            },
          });
        }
      }

      await tx.squad.update({
        where: { id: sid },
        data: { phase: "scheduled" },
      });
    });

    const snap = await buildSnapshot(prisma, sid, member.id);
    return c.json({ group: snap });
  });

  app.delete("/squads/:squadId/members/me", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) {
      return c.json({ error: "unauthorized", message: "Not signed in." }, 401);
    }
    await prisma.$transaction(async (tx) => {
      await tx.comment.deleteMany({ where: { memberId: member.id } });
      await tx.member.delete({ where: { id: member.id } });
    });
    return c.json({ ok: true });
  });

  app.delete("/squads/:squadId", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    if (member.squadId !== squadId) return c.json({ error: "forbidden" }, 403);
    await prisma.squad.delete({ where: { id: squadId } });
    return c.json({ ok: true });
  });

  app.put("/squads/:squadId/conflicts", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    let body: {
      slotAId?: string;
      slotBId?: string;
      choice?: string | null;
      planNote?: string | null;
      individualOnly?: boolean;
      planMode?: string | null;
      splitOrderSlotIds?: [string, string];
      customWindows?: { slotId: string; planFrom: string; planTo: string }[];
      groupLeanSlotId?: string | null;
      squadDefaultChoiceSlotId?: string | null;
      squadDefaultSplitOrderSlotIds?: [string, string];
      squadDefaultCustomWindows?: {
        slotId: string;
        planFrom: string;
        planTo: string;
      }[];
      clearSquadDefault?: boolean;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (!body.slotAId || !body.slotBId)
      return c.json({ error: "bad_request" }, 400);
    const [slotAId, slotBId] = normSlotPair(body.slotAId, body.slotBId);
    const normalizedNote =
      body.planNote === undefined
        ? undefined
        : body.planNote === null
          ? null
          : String(body.planNote).trim().slice(0, 500) || null;

    let planMode: string | null =
      typeof body.planMode === "string" ? body.planMode.trim() : null;
    if (!planMode && body.choice != null && String(body.choice).length > 0) {
      planMode = "pick";
    }

    const pickChoice =
      body.choice != null && String(body.choice).length > 0
        ? String(body.choice)
        : null;

    if (planMode === "pick") {
      if (!pickChoice || (pickChoice !== slotAId && pickChoice !== slotBId)) {
        return c.json({ error: "bad_choice" }, 400);
      }
    }

    let splitFirst: string | null = null;
    let splitSecond: string | null = null;
    if (planMode === "split_seq") {
      const o = body.splitOrderSlotIds;
      const pair = new Set([slotAId, slotBId]);
      if (
        !o ||
        o.length !== 2 ||
        o[0] === o[1] ||
        !pair.has(o[0]!) ||
        !pair.has(o[1]!)
      ) {
        return c.json({ error: "bad_split_order" }, 400);
      }
      splitFirst = o[0]!;
      splitSecond = o[1]!;
    }

    if (planMode === "custom") {
      const wins = body.customWindows;
      const pair = new Set([slotAId, slotBId]);
      if (!Array.isArray(wins) || wins.length !== 2) {
        return c.json({ error: "bad_custom_windows" }, 400);
      }
      const seen = new Set<string>();
      for (const w of wins) {
        if (!w?.slotId || !pair.has(w.slotId) || seen.has(w.slotId)) {
          return c.json({ error: "bad_custom_windows" }, 400);
        }
        seen.add(w.slotId);
      }
    }

    const pairIds = new Set([slotAId, slotBId]);
    let groupLeanSlotId: string | null = null;
    if (planMode === "group") {
      const raw = body.groupLeanSlotId;
      if (raw != null && String(raw).length > 0) {
        const id = String(raw);
        if (!pairIds.has(id)) {
          return c.json({ error: "bad_group_lean" }, 400);
        }
        groupLeanSlotId = id;
      }
    }

    let individualOnly: boolean;
    if (planMode === "group") {
      individualOnly = false;
    } else if (planMode === "pick" || planMode === "split_seq" || planMode === "custom") {
      individualOnly = true;
    } else {
      individualOnly = Boolean(body.individualOnly);
    }

    let squadDefaultChoice: string | null = null;
    let squadDefaultSplitOrder: [string, string] | null = null;
    let squadDefaultCustomWins:
      | { slotId: string; planFrom: string; planTo: string }[]
      | null = null;

    if (planMode === "group") {
      const sc =
        body.squadDefaultChoiceSlotId != null &&
        String(body.squadDefaultChoiceSlotId).length > 0
          ? String(body.squadDefaultChoiceSlotId)
          : null;
      if (sc && sc !== slotAId && sc !== slotBId) {
        return c.json({ error: "bad_squad_default" }, 400);
      }

      const so = body.squadDefaultSplitOrderSlotIds;
      let splitOrd: [string, string] | null = null;
      if (so != null) {
        if (!Array.isArray(so) || so.length !== 2) {
          return c.json({ error: "bad_squad_split" }, 400);
        }
        const pair = new Set([slotAId, slotBId]);
        if (
          so[0] === so[1] ||
          !pair.has(so[0]!) ||
          !pair.has(so[1]!)
        ) {
          return c.json({ error: "bad_squad_split" }, 400);
        }
        splitOrd = [so[0]!, so[1]!];
      }

      if (body.squadDefaultCustomWindows != null) {
        const wins = body.squadDefaultCustomWindows;
        const pair = new Set([slotAId, slotBId]);
        if (!Array.isArray(wins) || wins.length !== 2) {
          return c.json({ error: "bad_squad_custom" }, 400);
        }
        const seen = new Set<string>();
        const normalized: { slotId: string; planFrom: string; planTo: string }[] =
          [];
        for (const w of wins) {
          if (!w?.slotId || !pair.has(w.slotId) || seen.has(w.slotId)) {
            return c.json({ error: "bad_squad_custom" }, 400);
          }
          seen.add(w.slotId);
          const from = String(w.planFrom).trim();
          const to = String(w.planTo).trim();
          if (!/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to)) {
            return c.json({ error: "bad_squad_custom" }, 400);
          }
          normalized.push({ slotId: w.slotId, planFrom: from, planTo: to });
        }
        squadDefaultCustomWins = normalized;
      }

      const modes = [sc, splitOrd, squadDefaultCustomWins].filter(Boolean)
        .length;
      if (modes > 1) {
        return c.json({ error: "bad_squad_default_multi" }, 400);
      }

      squadDefaultChoice = sc;
      squadDefaultSplitOrder = splitOrd;
    }

    await prisma.$transaction(async (tx) => {
      await tx.conflictResolution.upsert({
        where: {
          squadId_memberId_slotAId_slotBId: {
            squadId: member.squadId,
            memberId: member.id,
            slotAId,
            slotBId,
          },
        },
        create: {
          squadId: member.squadId,
          memberId: member.id,
          slotAId,
          slotBId,
          choice: planMode === "pick" ? pickChoice : null,
          planNote: normalizedNote === undefined ? null : normalizedNote,
          individualOnly,
          planMode,
          splitFirstSlotId: planMode === "split_seq" ? splitFirst : null,
          splitSecondSlotId: planMode === "split_seq" ? splitSecond : null,
          groupLeanSlotId: planMode === "group" ? groupLeanSlotId : null,
        },
        update: {
          choice: planMode === "pick" ? pickChoice : null,
          ...(normalizedNote !== undefined ? { planNote: normalizedNote } : {}),
          individualOnly,
          planMode,
          splitFirstSlotId: planMode === "split_seq" ? splitFirst : null,
          splitSecondSlotId: planMode === "split_seq" ? splitSecond : null,
          groupLeanSlotId: planMode === "group" ? groupLeanSlotId : null,
        },
      });

      await patchIntentsForConflict(tx, member.squadId, member.id, slotAId, slotBId, {
        planMode,
        choice: pickChoice,
        splitOrderSlotIds:
          planMode === "split_seq" && splitFirst && splitSecond
            ? [splitFirst, splitSecond]
            : null,
        customWindows: planMode === "custom" ? body.customWindows ?? null : null,
      });

      if (planMode === "group" && body.clearSquadDefault) {
        await tx.squadClashDefault.deleteMany({
          where: {
            squadId: member.squadId,
            slotAId,
            slotBId,
          },
        });
      }

      if (planMode === "group" && squadDefaultChoice) {
        await tx.squadClashDefault.upsert({
          where: {
            squadId_slotAId_slotBId: {
              squadId: member.squadId,
              slotAId,
              slotBId,
            },
          },
          create: {
            squadId: member.squadId,
            slotAId,
            slotBId,
            defaultPlanMode: "pick",
            choiceSlotId: squadDefaultChoice,
            splitFirstSlotId: null,
            splitSecondSlotId: null,
            customWindows: Prisma.JsonNull,
            setByMemberId: member.id,
          },
          update: {
            defaultPlanMode: "pick",
            choiceSlotId: squadDefaultChoice,
            splitFirstSlotId: null,
            splitSecondSlotId: null,
            customWindows: Prisma.JsonNull,
            setByMemberId: member.id,
          },
        });
        await applyPickChoiceToIntents(
          tx,
          member.squadId,
          member.id,
          slotAId,
          slotBId,
          squadDefaultChoice
        );
      }

      if (planMode === "group" && squadDefaultSplitOrder) {
        const [f, s2] = squadDefaultSplitOrder;
        await tx.squadClashDefault.upsert({
          where: {
            squadId_slotAId_slotBId: {
              squadId: member.squadId,
              slotAId,
              slotBId,
            },
          },
          create: {
            squadId: member.squadId,
            slotAId,
            slotBId,
            defaultPlanMode: "split_seq",
            choiceSlotId: null,
            splitFirstSlotId: f,
            splitSecondSlotId: s2,
            customWindows: Prisma.JsonNull,
            setByMemberId: member.id,
          },
          update: {
            defaultPlanMode: "split_seq",
            choiceSlotId: null,
            splitFirstSlotId: f,
            splitSecondSlotId: s2,
            customWindows: Prisma.JsonNull,
            setByMemberId: member.id,
          },
        });
        await patchIntentsForConflict(
          tx,
          member.squadId,
          member.id,
          slotAId,
          slotBId,
          {
            planMode: "split_seq",
            choice: null,
            splitOrderSlotIds: squadDefaultSplitOrder,
            customWindows: null,
          }
        );
      }

      if (planMode === "group" && squadDefaultCustomWins) {
        await tx.squadClashDefault.upsert({
          where: {
            squadId_slotAId_slotBId: {
              squadId: member.squadId,
              slotAId,
              slotBId,
            },
          },
          create: {
            squadId: member.squadId,
            slotAId,
            slotBId,
            defaultPlanMode: "custom",
            choiceSlotId: null,
            splitFirstSlotId: null,
            splitSecondSlotId: null,
            customWindows: squadDefaultCustomWins,
            setByMemberId: member.id,
          },
          update: {
            defaultPlanMode: "custom",
            choiceSlotId: null,
            splitFirstSlotId: null,
            splitSecondSlotId: null,
            customWindows: squadDefaultCustomWins,
            setByMemberId: member.id,
          },
        });
        await patchIntentsForConflict(
          tx,
          member.squadId,
          member.id,
          slotAId,
          slotBId,
          {
            planMode: "custom",
            choice: null,
            splitOrderSlotIds: null,
            customWindows: squadDefaultCustomWins,
          }
        );
      }
    });

    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  /** Match this member’s plan to the combined group plan (anyone’s wants). */
  app.post("/squads/:squadId/plan/sync-from-group", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    if (member.squadId !== squadId) return c.json({ error: "forbidden" }, 403);
    const sid = member.squadId;
    const allRows = await prisma.memberSlotIntent.findMany({
      where: { squadId: sid },
      select: { slotId: true, wants: true },
    });
    const anyoneWants = new Set<string>();
    for (const r of allRows) {
      if (r.wants) anyoneWants.add(r.slotId);
    }
    const scheduleSlots = await prisma.scheduleSlot.findMany({
      where: { squadId: sid },
      select: { id: true },
    });
    await prisma.$transaction(async (tx) => {
      for (const s of scheduleSlots) {
        const w = anyoneWants.has(s.id);
        await tx.memberSlotIntent.upsert({
          where: {
            memberId_slotId: { memberId: member.id, slotId: s.id },
          },
          create: {
            squadId: sid,
            memberId: member.id,
            slotId: s.id,
            wants: w,
            personalPlanOnly: false,
            scheduleKeep: false,
            planFrom: null,
            planTo: null,
          },
          update: {
            wants: w,
            personalPlanOnly: false,
            planFrom: null,
            planTo: null,
          },
        });
      }
    });
    const snap = await buildSnapshot(prisma, sid, member.id);
    return c.json({ group: snap });
  });

  app.put("/squads/:squadId/slot-intents", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    if (member.squadId !== squadId) return c.json({ error: "forbidden" }, 403);
    let body: {
      intents?: {
        slotId?: string;
        wants?: boolean;
        scheduleKeep?: boolean;
        personalPlanOnly?: boolean;
        planFrom?: string | null;
        planTo?: string | null;
      }[];
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const intents = Array.isArray(body.intents) ? body.intents : [];
    const rows = intents
      .map((row) => {
        const slotId = String(row.slotId ?? "").trim();
        const wants = Boolean(row.wants);
        const scheduleKeepExplicit =
          row.scheduleKeep !== undefined && row.scheduleKeep !== null
            ? Boolean(row.scheduleKeep)
            : undefined;
        const personalPlanOnlyExplicit =
          row.personalPlanOnly !== undefined && row.personalPlanOnly !== null
            ? Boolean(row.personalPlanOnly)
            : undefined;
        const planFrom =
          row.planFrom != null && String(row.planFrom).trim()
            ? String(row.planFrom).trim()
            : null;
        const planTo =
          row.planTo != null && String(row.planTo).trim()
            ? String(row.planTo).trim()
            : null;
        return {
          slotId,
          wants,
          scheduleKeepExplicit,
          personalPlanOnlyExplicit,
          planFrom,
          planTo,
        };
      })
      .filter((row) => row.slotId.length > 0);

    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const existing = await tx.memberSlotIntent.findUnique({
          where: {
            memberId_slotId: { memberId: member.id, slotId: row.slotId },
          },
        });
        const scheduleKeep =
          row.scheduleKeepExplicit !== undefined
            ? row.scheduleKeepExplicit
            : (existing?.scheduleKeep ?? false);
        const personalPlanOnly = row.wants
          ? row.personalPlanOnlyExplicit !== undefined
            ? row.personalPlanOnlyExplicit
            : (existing?.personalPlanOnly ?? false)
          : false;
        await tx.memberSlotIntent.upsert({
          where: {
            memberId_slotId: { memberId: member.id, slotId: row.slotId },
          },
          create: {
            squadId,
            memberId: member.id,
            slotId: row.slotId,
            wants: row.wants,
            personalPlanOnly,
            scheduleKeep,
            planFrom: row.planFrom,
            planTo: row.planTo,
          },
          update: {
            wants: row.wants,
            personalPlanOnly,
            scheduleKeep,
            planFrom: row.planFrom,
            planTo: row.planTo,
          },
        });
      }
    });
    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  app.patch("/squads/:squadId/schedule-keep", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    let body: { slotId?: string; keep?: boolean };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const slotId = String(body.slotId ?? "").trim();
    if (!slotId) return c.json({ error: "bad_request" }, 400);
    const keep = Boolean(body.keep);
    const slot = await prisma.scheduleSlot.findFirst({
      where: { id: slotId, squadId: member.squadId },
    });
    if (!slot) return c.json({ error: "not_found" }, 404);

    await prisma.memberSlotIntent.upsert({
      where: {
        memberId_slotId: { memberId: member.id, slotId },
      },
      create: {
        squadId: member.squadId,
        memberId: member.id,
        slotId,
        wants: true,
        personalPlanOnly: false,
        scheduleKeep: keep,
        planFrom: null,
        planTo: null,
      },
      update: { scheduleKeep: keep },
    });
    const snap = await buildSnapshot(prisma, member.squadId, member.id);
    return c.json({ group: snap });
  });

  app.post("/parse/lineup", async (c) => {
    const parsed = await visionJsonFromForm(
      c,
      "Extract every performing artist or band name from this lineup poster. Ignore sponsors, logos text, and ticket URLs.",
      'Schema: {"artists":["Name One","Name Two"]}'
    );
    if (parsed instanceof Response) return parsed;
    const artists = Array.isArray(parsed.artists)
      ? parsed.artists.map((x) => String(x).trim()).filter(Boolean)
      : [];
    return c.json({ artists });
  });

  app.post("/parse/schedule", async (c) => {
    const prompt =
      "Extract the timetable: each performance with day name (short), stage/venue name, start time, end time, and artist. " +
      "Use 24h HH:mm when obvious; otherwise use 12h-style times (am/pm if printed, or bare hours like 1, 7:30). " +
      "Do not invent am/pm when missing — bare numbers are OK. " +
      "CRITICAL — stage columns: the image is usually a grid where each **vertical column** is one stage and acts in that column share that stage name (read the column header at the top of that column). " +
      "Assign each slot’s stageName from the **column header** above that act’s cell, not from a nearby column or a guess. " +
      "If headers are abbreviated, copy them exactly as printed; do not merge two columns into one stage or move an act to a different column’s stage.";
    const schemaHint =
      'Schema: {"slots":[{"dayLabel":"Fri","stageName":"Main","start":"18:00","end":"19:00","artistName":"Act"}]}';

    const form = await c.req.formData();
    const files = form
      .getAll("file")
      .filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return c.json(
        {
          error: "missing_file",
          message: "Expected one or more multipart files named file",
        },
        400
      );
    }

    const merged: {
      dayLabel: string;
      stageName: string;
      start: string;
      end: string;
      artistName: string;
    }[] = [];

    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const mime = file.type || "image/jpeg";
      const result = await runVisionJson(buf, mime, schemaHint, prompt);
      if (!result.ok) {
        return c.json(
          { error: "vision_unconfigured", message: result.message },
          503
        );
      }
      const rawSlots = Array.isArray(result.json.slots)
        ? result.json.slots
        : [];
      for (const item of rawSlots) {
        const s = item as Record<string, unknown>;
        const row = {
          dayLabel: String(s.dayLabel ?? s.day ?? "").trim() || "?",
          stageName: String(s.stageName ?? s.stage ?? "Main").trim(),
          start: String(s.start ?? s.startTime ?? "").trim(),
          end: String(s.end ?? s.endTime ?? "").trim(),
          artistName: String(
            s.artistName ?? s.artist ?? s.name ?? ""
          ).trim(),
        };
        if (row.artistName && row.start && row.end) merged.push(row);
      }
    }

    const seen = new Set<string>();
    const deduped = merged.filter((s) => {
      const k =
        `${s.dayLabel}\t${s.stageName}\t${s.start}\t${s.end}\t${s.artistName}`.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const slots = normalizeScheduleTimesForImport(deduped);
    return c.json({ slots });
  });

  /**
   * Build a “festival setlist” from setlist.fm for artists this member ❤️/🔥 on lineup
   * or has on their plan.
   */
  app.post("/squads/:squadId/setlist/preview", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    let body: { artistIds?: string[]; maxSetlistsPerArtist?: number };
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const maxSetlists = Math.min(
      8,
      Math.max(1, Math.floor(body.maxSetlistsPerArtist ?? 4))
    );

    const res = await getArtistsForMemberSetlist(member, { artistIds: body.artistIds });
    if (!res.ok) {
      return c.json(
        {
          error: "too_many_artists",
          message: "Select at most 30 artists (lineup + plan) for one preview.",
        },
        400
      );
    }

    const preview = await buildSetlistPreviewForArtists(res.artists, {
      maxSetlistsPerArtist: maxSetlists,
    });
    return c.json(preview);
  });

  app.get("/squads/:squadId/spotify/status", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    return c.json({
      clientConfigured: isSpotifySearchConfigured(),
      redirectUriConfigured: Boolean(spotifyBackendRedirectUri()),
      canSignIn:
        isSpotifySearchConfigured() &&
        isSpotifyStateSignable() &&
        Boolean(spotifyBackendRedirectUri()),
      spotifyConnected: Boolean(member.spotifyRefreshToken),
    });
  });

  /** Returns Spotify authorize URL (browser navigates to start OAuth). */
  app.get("/squads/:squadId/spotify/authorize", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    const returnTo = (c.req.query("returnTo") as string) ?? "";
    if (!isSafeSpotifyReturnPath(returnTo)) {
      return c.json(
        { error: "invalid_return", message: "returnTo must be a path like /squad/.../lineup" },
        400
      );
    }
    if (!isSpotifySearchConfigured() || !spotifyBackendRedirectUri() || !isSpotifyStateSignable()) {
      return c.json(
        {
          error: "spotify_not_configured",
          message:
            "Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI (e.g. https://yoursite.com/api/spotify/callback) and a state secret (SPOTIFY_STATE_SECRET or reuse client secret).",
        },
        503
      );
    }
    const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
    const redirectUri = spotifyBackendRedirectUri()!;
    if (!clientId) {
      return c.json({ error: "spotify_not_configured" }, 503);
    }
    const state = signSpotifyState(member.id, member.squadId, returnTo);
    const scope = "playlist-modify-private user-read-private offline_access";
    const u = new URL("https://accounts.spotify.com/authorize");
    u.searchParams.set("client_id", clientId);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("scope", scope);
    u.searchParams.set("state", state);
    return c.json({ url: u.toString() });
  });

  app.get("/spotify/callback", async (c) => {
    const err = c.req.query("error") as string | undefined;
    const stateQ = c.req.query("state") as string | undefined;
    const code = c.req.query("code") as string | undefined;
    const base = getPublicRequestOrigin(c);

    const withSpotifyQ = (path: string, q: Record<string, string>) => {
      const p = path.startsWith("/") ? path : `/${path}`;
      const sp = new URLSearchParams(q);
      return `${base}${p}?${sp.toString()}`;
    };

    const afterDeny = (path: string) =>
      c.redirect(withSpotifyQ(path, { spotify: "denied" }), 302);

    if (err) {
      const p = stateQ ? verifySpotifyState(stateQ) : null;
      return afterDeny(p?.returnPath ?? "/");
    }
    if (!code || !stateQ) {
      return c.text("Bad request", 400);
    }
    const p = verifySpotifyState(stateQ);
    if (!p) {
      return c.text("Invalid or expired state — try Connect Spotify again.", 400);
    }
    const redirectUri = spotifyBackendRedirectUri();
    if (!redirectUri) {
      return c.redirect(
        withSpotifyQ(p.returnPath, { spotify: "error", reason: "no_redirect_uri" }),
        302
      );
    }
    const tok = await spotifyExchangeCodeForToken(code, redirectUri);
    if (!tok?.access_token) {
      return c.redirect(
        withSpotifyQ(p.returnPath, { spotify: "error", reason: "token_exchange" }),
        302
      );
    }
    if (!tok.refresh_token) {
      return c.redirect(
        withSpotifyQ(p.returnPath, { spotify: "error", reason: "no_refresh" }),
        302
      );
    }
    const m = await prisma.member.findFirst({
      where: { id: p.memberId, squadId: p.squadId },
    });
    if (!m) {
      return c.redirect(
        withSpotifyQ(p.returnPath, { spotify: "error", reason: "member" }),
        302
      );
    }
    try {
      await prisma.member.update({
        where: { id: p.memberId },
        data: { spotifyRefreshToken: tok.refresh_token! },
      });
    } catch (e) {
      console.error("[clasher] spotify save token", e);
      return c.redirect(
        withSpotifyQ(p.returnPath, { spotify: "error", reason: "db" }),
        302
      );
    }
    return c.redirect(`${base}${p.returnPath}?spotify=connected`, 302);
  });

  app.post("/squads/:squadId/setlist/spotify-playlist", async (c) => {
    const squadId = c.req.param("squadId");
    const member = await authMember(c, squadId);
    if (!member) return c.json({ error: "unauthorized" }, 401);
    if (!isSpotifySearchConfigured()) {
      return c.json(
        { error: "spotify_not_configured", message: "Spotify is not configured on the server." },
        503
      );
    }
    if (!member.spotifyRefreshToken) {
      return c.json(
        { error: "need_spotify", message: "Connect Spotify (green button) before creating a playlist." },
        400
      );
    }
    let body: { artistIds?: string[]; maxSetlistsPerArtist?: number; maxSpotifyUris?: number };
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const maxSetlists = Math.min(8, Math.max(1, Math.floor(body.maxSetlistsPerArtist ?? 4)));
    const maxUris = Math.min(200, Math.max(1, Math.floor(body.maxSpotifyUris ?? 150)));

    const res = await getArtistsForMemberSetlist(member, { artistIds: body.artistIds });
    if (!res.ok) {
      return c.json(
        { error: "too_many_artists", message: "Select at most 30 artists (lineup + plan)." },
        400
      );
    }
    const preview = await buildSetlistPreviewForArtists(res.artists, {
      maxSetlistsPerArtist: maxSetlists,
    });
    if (!preview.combined.length) {
      return c.json(
        { error: "empty_setlist", message: "No songs to add — run Build on the setlist first or pick different artists." },
        400
      );
    }
    const { uris, notFound } = await spotifyUrisForSetlistRows(preview.combined, maxUris);
    if (uris.length === 0) {
      return c.json(
        { error: "no_spotify_tracks", message: "Could not find matching tracks on Spotify for these song titles." },
        400
      );
    }

    const userTok = await spotifyRefreshUserAccess(member.spotifyRefreshToken);
    if (!userTok?.access_token) {
      return c.json(
        { error: "need_spotify", message: "Spotify session expired — connect again from Lineup." },
        401
      );
    }
    if (userTok.refresh_token) {
      await prisma.member.update({
        where: { id: member.id },
        data: { spotifyRefreshToken: userTok.refresh_token },
      });
    }
    const squad = await prisma.squad.findUnique({
      where: { id: member.squadId },
      select: { festivalName: true },
    });
    const festival = squad?.festivalName?.trim() || "Festival";
    const pl = await spotifyCreatePlaylist(
      userTok.access_token,
      `${festival} (Clasher)`,
      "From your Clasher festival setlist. github.com/andre-zhang/clasher"
    );
    if (!pl?.id) {
      return c.json({ error: "create_playlist", message: "Spotify refused to create the playlist." }, 502);
    }
    const added = await spotifyAddTracks(pl.id, userTok.access_token, uris);
    if (!added) {
      return c.json(
        { error: "add_tracks", message: "Playlist was created but adding tracks failed." },
        502
      );
    }
    const playlistUrl = pl.external_urls?.spotify ?? `https://open.spotify.com/playlist/${pl.id}`;
    return c.json({ playlistUrl, trackCount: uris.length, notFound });
  });

  return app;
}
