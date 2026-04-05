import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { prisma } from "@/lib/prisma";

import { dbErrorHttpResponse } from "./dbErrors";
import {
  DEMO_ARTIST_NAMES,
  DEMO_SEED_ARTIST_NAMES,
  DEMO_SLOT_ROWS,
} from "./demoFestivalData";
import { wantsDeltaFromChoice } from "./memberSlotIntentPatch";
import { buildSnapshot } from "./snapshot";
import { runVisionJson } from "./vision";

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
        artists: {
          createMany: {
            data: DEMO_SEED_ARTIST_NAMES.map((name, sortOrder) => ({
              name,
              sortOrder,
            })),
          },
        },
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

    const member = await prisma.member.create({
      data: { squadId: squad.id, displayName },
    });
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
      await tx.conflictResolution.deleteMany({ where: { squadId: sid } });
      await tx.scheduleSlot.deleteMany({ where: { squadId: sid } });
      await tx.memberSlotIntent.deleteMany({ where: { squadId: sid } });
      await tx.rating.deleteMany({
        where: { artist: { squadId: sid } },
      });
      await tx.comment.deleteMany({ where: { squadId: sid } });
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
    const indiv = Boolean(body.individualOnly);
    await prisma.conflictResolution.upsert({
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
        choice: body.choice ?? null,
        planNote: normalizedNote === undefined ? null : normalizedNote,
        individualOnly: indiv,
      },
      update: {
        choice: body.choice ?? null,
        ...(normalizedNote !== undefined ? { planNote: normalizedNote } : {}),
        individualOnly: indiv,
      },
    });
    if (body.choice != null && typeof body.choice === "string") {
      const delta = wantsDeltaFromChoice(slotAId, slotBId, body.choice);
      for (const [slotId, wants] of Object.entries(delta)) {
        await prisma.memberSlotIntent.upsert({
          where: {
            memberId_slotId: { memberId: member.id, slotId },
          },
          create: {
            squadId: member.squadId,
            memberId: member.id,
            slotId,
            wants,
            planFrom: null,
            planTo: null,
          },
          update: { wants, planFrom: null, planTo: null },
        });
      }
    }
    const snap = await buildSnapshot(prisma, member.squadId, member.id);
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
    await prisma.$transaction(async (tx) => {
      await tx.memberSlotIntent.deleteMany({
        where: { squadId, memberId: member.id },
      });
      const rows = intents
        .map((row) => ({
          squadId,
          memberId: member.id,
          slotId: String(row.slotId ?? ""),
          wants: Boolean(row.wants),
          planFrom:
            row.planFrom != null && String(row.planFrom).trim()
              ? String(row.planFrom).trim()
              : null,
          planTo:
            row.planTo != null && String(row.planTo).trim()
              ? String(row.planTo).trim()
              : null,
        }))
        .filter((row) => row.slotId.length > 0);
      if (rows.length > 0) {
        await tx.memberSlotIntent.createMany({ data: rows });
      }
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
    const parsed = await visionJsonFromForm(
      c,
      "Extract the timetable: each performance with day name (short), stage/venue name, start time, end time, and artist. Use 24h HH:mm for times if possible.",
      'Schema: {"slots":[{"dayLabel":"Fri","stageName":"Main","start":"18:00","end":"19:00","artistName":"Act"}]}'
    );
    if (parsed instanceof Response) return parsed;
    const rawSlots = Array.isArray(parsed.slots) ? parsed.slots : [];
    const slots = rawSlots
      .map((s) => s as Record<string, unknown>)
      .filter(Boolean)
      .map((s) => ({
        dayLabel: String(s.dayLabel ?? s.day ?? "").trim() || "?",
        stageName: String(s.stageName ?? s.stage ?? "Main").trim(),
        start: String(s.start ?? s.startTime ?? "").trim(),
        end: String(s.end ?? s.endTime ?? "").trim(),
        artistName: String(
          s.artistName ?? s.artist ?? s.name ?? ""
        ).trim(),
      }))
      .filter((s) => s.artistName && s.start && s.end);
    return c.json({ slots });
  });

  return app;
}
