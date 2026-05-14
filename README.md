# Clasher

**Try it:** [https://clasher-three.vercel.app/](https://clasher-three.vercel.app/)

## Inspiration

I like music festivals, but the planning side is always chaos: PDF timetables, screenshots in the group chat, half a spreadsheet nobody updates. Plenty of apps look nice for a solo timetable, not many are built so a whole group can share one schedule, see where tastes collide, and agree what to do about it. Clasher is basically that: one squad, one source of truth in Postgres, and UI that stays honest once you turn on walk times between stages.

## What it does

- Start from the home screen: **Create a group** (new squad + invite token) or **Join with a code** (token in the URL path, then a display name). Your browser keeps a small session (`localStorage`) with squad id, member id, and a random secret; API calls send `Authorization: Bearer <secret>` so you do not log in with passwords.
- **Lineup** is the artist list for that festival. Anyone can rate each artist must / want / maybe / skip, leave short comments, and use the emoji reactions. You can pull artists in from a lineup poster or screenshot through the vision parse endpoint, or use demo seed data if you just want to click around without keys.
- **Schedule** is multi-day rows keyed by `dayLabel`, stage name, start/end as `HH:mm`, and a link to an artist row. You can replace the whole grid, append rows, patch one slot, merge duplicates, or again seed demo slots. Per-set **slot comments** (emoji or text) sit on individual slots, separate from lineup comments.
- **Clashes** reads the same **snapshot** the rest of the app uses (`GET /api/squads/:squadId/snapshot`). A pair counts if two sets are impossible for one person to do back-to-back: either true time overlap, or no overlap but the gap is smaller than the walk minutes between stages when walk mode is on. The list only highlights pairs where at least one member rated **both** artists as must or want, so you are not drowning in every overlap on the poster.
- **Resolving** a clash writes `ConflictResolution` plus updates `MemberSlotIntent` in a transaction. Modes include pick a winner, split the overlap into two ordered partial windows, custom windows per slot, follow a **squad default** for that slot pair (`SquadClashDefault` with pick / split_seq / custom JSON), or **group** mode where the squad default drives everyone until someone overrides. Pick mode keeps plan windows on the slot you keep so a later clash does not wipe half your day by accident.
- **Plans** is the drag-to-order strip, optional `planFrom` / `planTo` windows inside a slot, flags for “only on my strip” vs merged **Everyone** view, and `scheduleKeep` so something stays visible on your calendar even when it came from a clash edge case. There is an action to sync your strip from the group default when you want to reset toward the squad.
- **Options** holds squad-wide knobs: walk times on or off, optional festival map image, vision-assisted stage label extraction, a map-label to schedule-stage alias table, and the walk matrix (minutes between stages, capped, with defaults inferred from map stage order when you do not fill every cell).
- **Study playlist** on the lineup: pull recent setlists from setlist.fm into a weighted preview table, then optionally connect Spotify (OAuth per member, refresh token stored on the member row), resolve titles to track URIs with throttled search, and create a playlist on that user’s account.
- **Wallpaper export** renders a tall 9×16 PNG of your day plan in the browser, using the same festival timeline and walk hints as the schedule views, including an optional “leave by …” line when travel forces you out before the official set end.

## Tech stack

- Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS
- Routes under `src/app/`: `/`, `/create`, `/join`, `/join/[token]`, `/join/[token]/[memberSlug]`, `/squad/[squadId]` with nested lineup, schedule, clashes, plans, options, invite
- PostgreSQL + Prisma 6 (`prisma/schema.prisma`); Hono API in `src/server/festivalApp.ts` mounted at `/api` via `src/app/api/[[...route]]/route.ts`
- Client session + snapshot wiring in `src/context/ClasherContext.tsx`, typed fetches in `src/lib/api.ts`
- Time and calendar logic: `src/lib/timeHm.ts` (festival-day timeline with a 1pm wall-clock origin), `src/lib/scheduleTimeNormalize.ts` for imports and vision output, `src/lib/clash.ts` + `src/lib/walkFeasibility.ts` for overlap vs walk gaps
- Intent derivation and conflict follow-through: `src/lib/effectiveIntents.ts`, `src/server/applyConflictIntents.ts`, `src/server/snapshot.ts` for the payload shape
- Vision: `src/server/vision.ts` (OpenAI and/or Anthropic, `VISION_PROVIDER` auto routing), multipart handlers on `/api/parse/lineup` and `/api/parse/schedule`
- Setlist and Spotify: `src/lib/setlistfm.ts`, `src/lib/setlistPreview.ts`, `src/lib/setlistFmBudget.ts`, `src/lib/spotifyResolveUris.ts`, `src/lib/spotifyUserPlaylist.ts`, `src/lib/spotifyState.ts`
- Plan PNG: `src/lib/planWallpaper.ts` plus schedule UI components under `src/components/`
- Node 20+; `npm run build` runs Prisma generate then `next build` (`scripts/vercel-build.mjs`)

## Challenges (implementation)

**Festival timeline vs wall clock**

The app does not treat midnight as a hard day boundary for festival logic. Same `dayLabel` uses a single timeline where 13:00 wall maps to 0 and times after midnight continue forward (`wallMinutesToFestivalTimeline` and inverse in `timeHm.ts`). Sorting, overlap tests, calendar Y layout, and export all have to agree on that representation or clashes silently disagree with what people see on the grid.

**Normalising pasted or scanned times**

Vision and OCR return messy strings. `scheduleTimeNormalize.ts` resolves bare 12-hour times with a per-day, per-stage alternation heuristic, moves 00:xx starts to the previous festival day when that matches how posters label “after midnight still Saturday”, and patches a few systematic misreads (wrong AM on an afternoon block, end time read an hour off). One bad normalisation poisons walk feasibility for the whole squad.

**Walk matrix keys vs schedule stage names**

Walk minutes live in a sparse JSON matrix keyed by stage names as they appear on slots. Map vision proposes different strings than the timetable, so `stageMapAlias` and ordered labels from the image matter. `walkFeasibility.ts` caps values, mirrors missing direction pairs, and short-circuits when walk mode is disabled; `slotsInfeasibleTogether` must treat sequential slots with insufficient gap the same class of problem as overlapping slots for downstream UI.

**Effective intents vs raw rows**

The strip and calendars do not read `MemberSlotIntent` alone. `effectiveIntents.ts` folds in personal split resolutions, group mode + squad defaults, and custom JSON windows so the UI shows the window you actually get after a clash. `patchIntentsForConflict` on the server has to apply the same rules when persisting or the next snapshot disagrees with what the member just saved.

**Snapshot assembly**

`buildSnapshot` does one squad query with schedule and members, then parallel reads for ratings, both artist and slot comments, every member’s intents, conflicts, and squad defaults. JSON blobs get parsed into typed structures (walk matrix, custom windows). The response mixes “this member’s” intent slice with `allMemberSlotIntents` for group views, so a small shape bug shows up as wrong colours on Everyone’s calendar.

**Vision and error surfaces**

Multipart uploads hit models that return JSON as text, sometimes fenced in markdown. Parsing tolerates that, but misconfigured keys must return JSON bodies with stable `error` codes (`vision_unconfigured`, etc.) so the client does not treat a Next HTML 404 as “the model failed to read your poster”.

**Setlist titles to Spotify URIs**

setlist.fm gives strings; Spotify search is fuzzy and rate sensitive. Preview aggregation dedupes and budgets calls across artists (`setlistFmBudget`, merge helpers). URI resolution runs sequentially with a small delay (`spotifyResolveUris.ts`), caps how many tracks you resolve per playlist, and skips uncertain matches rather than filling with wrong recordings. OAuth uses signed state on redirect and persists rotating refresh tokens.

## Running locally

- Postgres and `DATABASE_URL` are required. Copy `.env.example` and add optional `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `VISION_PROVIDER` / `ANTHROPIC_MODEL` for scans, plus `SETLISTFM_API_KEY` and Spotify client id and secret for playlist flow.
- `npm run dev`, `npm run build`, `npm run db:generate`, `npm run db:push`, `npm run db:migrate`.

**Production checks:** API traffic should stay same-origin on `https://<host>/api/...`; `GET /api/health` returns `{ "ok": true }`; `POST /api/squads` and parse routes should return JSON errors, not an HTML 404 page.

**Deploy (e.g. Vercel):** connect the repo, set env vars, `npm run build`, then `npx prisma db push` or migrations against prod (or automate in CI).
