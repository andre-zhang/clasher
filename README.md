# Clasher

Live: [https://clasher-three.vercel.app/](https://clasher-three.vercel.app/)

## Inspiration

Group festival planning tends to scatter across screenshots, PDFs, and spreadsheets. This app keeps one squad, one schedule, and per-member intent in Postgres so the UI can show overlaps, travel constraints, and a merged view without everyone maintaining their own copy.

## What it does

Data is organised around a **squad** (festival name, optional date, phase, invite token). Members join with a token and get a random **secret**; authenticated API calls use `Authorization: Bearer <secret>` for that member.

**Lineup:** Artists are rows in the DB with sort order. Each member has **ratings** (must / want / maybe / skip) and optional **comments** on artists. There is logic to sync schedule interest from ratings when you want the shortlist to follow lineup tiers.

**Schedule:** Slots are `{ dayLabel, stageName, start, end, artistId }` with string times stored as `HH:mm`. The API supports replace, append, patch single slots, merge duplicates, and demo seed endpoints for testing without vision.

**Clashes:** The client works off a **snapshot** (`GET /api/squads/:squadId/snapshot`). Clash detection combines clock overlap with **walk feasibility**: two slots can be non-overlapping but still impossible back-to-back if the gap is smaller than the matrix walk time between stages (`walkFeasibility.ts`, `clash.ts`). Engaged pairs only surface when someone rates both artists as must/want so the list is not noise.

**Resolutions:** `ConflictResolution` rows store per-member outcomes: pick one slot, split sequence with derived plan windows, custom per-slot windows, follow squad default, or group mode. `SquadClashDefault` stores squad-wide defaults for a slot pair (pick / split_seq / custom JSON). Saving a resolution runs **transactional intent patches** (`applyConflictIntents.ts`) so `MemberSlotIntent` rows stay consistent with the choice (including edge cases like pick keeping plan windows on the winner).

**Plans:** Intents carry `wants`, optional `planFrom` / `planTo`, `personalPlanOnly`, and `scheduleKeep`. Effective windows for UI are **derived** in `effectiveIntents.ts` (personal splits, group lean, squad defaults). There is an endpoint to sync personal strip from group defaults.

**Squad options:** Walk times on/off, optional festival map image, map-derived stage label order, alias map from vision labels to schedule stage names, and JSON walk matrix. Map upload can call vision to propose labels and label-to-stage matches (`mapStages.ts`, defaults in `walkMatrixDefaults.ts`).

**Integrations:** Multipart **parse** routes for lineup or schedule images (`vision.ts`, OpenAI and/or Anthropic with `VISION_PROVIDER`). **setlist.fm** powers a weighted setlist preview on the lineup; **Spotify** uses OAuth per member (refresh token in DB), search-backed URI resolution with throttling, then playlist create + add tracks.

**Exports:** Client-side tall PNG plan wallpaper (`planWallpaper.ts` and related components) using the same timeline and walk hints as the schedule views.

## Tech stack

- Next.js 15 (App Router), React 19, TypeScript
- Tailwind CSS
- PostgreSQL, Prisma 6
- Hono app in `src/server/festivalApp.ts`, mounted at `/api` via `src/app/api/[[...route]]/route.ts`
- Optional `@anthropic-ai/sdk` and `openai` for vision JSON extraction from lineup, timetable, or map images
- setlist.fm + Spotify Web API for study playlist flow; Node 20+ for local dev and CI

## Challenges

### Festival timeline and imports

All same-day ordering and overlap math use a **1pm wall-clock origin** mapped to a 0..1439 festival timeline (`timeHm.ts`: `wallMinutesToFestivalTimeline` / inverse). That keeps afternoon, evening, and post-midnight sets on one continuous axis for a given `dayLabel`.

Imports and vision output hit `scheduleTimeNormalize.ts`: ambiguous 12-hour strings are disambiguated per day+stage scope, late-night starts after midnight can roll to the previous festival day label, and there are heuristics for common OCR mistakes (bad end time, wrong AM on afternoon starts). Getting this wrong breaks clash detection everywhere downstream.

### Walk matrix and attendability

Walk minutes are capped, symmetric lookup falls back to defaults, and the squad can disable walks entirely. `slotsInfeasibleTogether` compares timeline windows and sequential gaps with `walkMinutesBetweenStages`, so the code path for "overlap clash" and "tight changeover clash" stays shared. Stage names from the schedule have to line up with matrix keys; aliases from the map flow exist to reduce drift.

### Intent state after conflict edits

A member's visible plan is not just raw `MemberSlotIntent` rows. `effectiveIntents.ts` merges intents with active conflict resolutions and squad defaults, including split windows computed from slot times (`splitPriorityWindows` in `timeHm.ts`). Server-side `patchIntentsForConflict` must stay aligned with those rules or the snapshot and the next PATCH from the client disagree.

### Snapshot shape and scope

`buildSnapshot` loads squad + schedule in one query, then parallel fetches for ratings, comments, slot comments, conflicts, intents (for the **viewing** member and for **all** members), and squad clash defaults. JSON fields (walk matrix, custom windows) are validated/parsed into typed structures before the response. Anything expensive or inconsistent here shows up as subtle bugs in the group calendar and clashes tabs.

### Vision and multipart ingest

Lineup, schedule, and map analysis share a small provider abstraction (auto / OpenAI / Claude), base64 packaging, and JSON parsing with fenced-code tolerance. Failures need to return structured JSON (`vision_unconfigured`, etc.) so the client does not misread an HTML error page as a bad scan.

### Setlist to Spotify

Preview rows are aggregated and budgeted across artists (`setlistFmBudget`, merge helpers). Turning titles into playlist URIs is sequential Spotify search with backoff (`spotifyResolveUris.ts`), deduping, and a cap on how many tracks get resolved. OAuth state is signed and validated on callback; refresh tokens rotate and are persisted on the member row.

## Running locally

Requires Postgres and `DATABASE_URL`. Optional: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `VISION_PROVIDER`, `ANTHROPIC_MODEL` for parsing; `SETLISTFM_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` for setlist + Spotify. Copy `.env.example`.

Scripts: `npm run dev`, `npm run build`, `npm run db:generate`, `npm run db:push`, `npm run db:migrate`.

| Path | Role |
|------|------|
| `prisma/schema.prisma` | Squads, members, artists, ratings, schedule, intents, resolutions, squad defaults, comments |
| `src/server/festivalApp.ts` | HTTP routes and handlers |
| `src/server/snapshot.ts` | Snapshot assembly |
| `src/context/ClasherContext.tsx` | Client session + snapshot consumption |
| `src/lib/api.ts` | Typed fetch helpers |

### Production checks

1. API calls same-origin over HTTPS to `https://<host>/api/...`.
2. `GET /api/health` returns `{ "ok": true }`.
3. `POST /api/squads` and `POST /api/parse/lineup` or `/parse/schedule` return JSON or explicit error codes, not an HTML 404.

### Deploy (e.g. Vercel)

Point the project at this repo, set env vars, run `npm run build`, then `npx prisma db push` or migrations against the production database (or automate in CI).
