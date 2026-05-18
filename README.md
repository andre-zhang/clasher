# Clasher

**Try it:** [https://clasher-three.vercel.app/](https://clasher-three.vercel.app/)

## Inspiration

I like music festivals. I like them less when the plan lives in fifty screenshots and nobody agrees which set we are actually running to. Spreadsheets and shared docs help a little, but they rarely show where the group disagrees, and they almost never say whether two back-to-back sets are realistic once you factor in walking between stages.

Clasher is one shared festival: lineup, schedule, clashes, and plans in one place, so you are not re-explaining the same overlap in chat every hour.

## What it does

- Create a group or join with a code, pick a display name, and you are in. No separate accounts; the app remembers you on that device.
- **Lineup:** rate artists (must / want / maybe / skip), leave comments, use reactions. Type the bill or scan a lineup poster and tidy what comes back.
- **Schedule:** multi-day timetable by stage, tied to artists on the lineup. Type it in or scan a timetable image. Each set can have its own notes, separate from lineup chat.
- **Clashes:** sets that fight each other, either because they overlap or because the gap is too short once walk times are on. The list sticks to pairs where someone in the group rated both acts strongly enough to care.
- **Resolve:** pick one set, split time across both, set your own "only here for this slice" windows, or use a squad default for that pair. Group mode can align everyone until someone opts out. Resolving updates your plan, not just a checkbox.
- **Plans:** reorder your day on a strip, trim how long you stay at a set, keep something on your personal calendar when clash logic gets fiddly. Personal strip or shared "everyone" view; you can reset toward what the group agreed.
- **Options:** walk times on or off, upload a festival map, tune minutes between stages (or start from map order), match map labels to timetable stage names when they differ.
- **Study playlist:** pull recent setlists for artists you are planning to see, preview tracks, connect Spotify, create a playlist on your account.
- **Wallpaper:** tall phone-shaped PNG of a day plan, with leave-early hints when you need to move before a set ends.

## Tech stack

Next.js 15 App Router (React 19, TypeScript, Tailwind), with squad flows from `/create` and `/join/[token]` through `/squad/[squadId]/*` (lineup, schedule, clashes, plans, options, invite). Client session in `ClasherContext.tsx`, typed HTTP in `src/lib/api.ts`.

Postgres and Prisma 6 (`prisma/schema.prisma`). Hono in `src/server/festivalApp.ts`, mounted at `/api` through `src/app/api/[[...route]]/route.ts`. Members auth with a per-member Bearer secret; there is no password table.

Almost everything renders from one server **snapshot** (`src/server/snapshot.ts`): schedule, ratings, comments, conflict resolutions, squad clash defaults, each member's intents, plus the viewer's slice and `allMemberSlotIntents` for group calendars. That avoids stitching partial API responses on the client, but `buildSnapshot` is a choke point if shapes drift.

- **Time:** `timeHm.ts` maps wall clock to a festival-day axis (1pm origin); `scheduleTimeNormalize.ts` cleans imports and vision output.
- **Clashes / walks:** `clash.ts`, `walkFeasibility.ts` (overlap vs tight changeover; capped matrix, optional off).
- **Intents:** `effectiveIntents.ts` derives plan windows; `applyConflictIntents.ts` writes intents in the same transaction as resolutions.
- **Vision:** `vision.ts` (OpenAI / Anthropic, `VISION_PROVIDER` auto); multipart parse for lineup and schedule images.
- **Setlists / Spotify:** setlist.fm aggregation in `setlistPreview.ts` / `setlistFmBudget.ts`; OAuth and URI search in `spotifyResolveUris.ts`, `spotifyUserPlaylist.ts`.
- **Export:** `planWallpaper.ts` reuses the same timeline and walk bands as the schedule UI.

## Challenges (implementation)

**Festival timeline.** A festival "day" is not midnight-aligned. `wallMinutesToFestivalTimeline` keeps afternoon through after-midnight on one axis per `dayLabel`. Sorting, overlap checks, calendar layout, and export all depend on the same mapping.

**Import normalisation.** Vision and paste return messy times. `scheduleTimeNormalize.ts` guesses AM/PM per stage, rolls post-midnight rows to the right day label, and patches common OCR mistakes. One bad row can make an impossible changeover look fine.

**Walk matrix vs stage names.** Walk minutes are keyed by timetable stage strings. Map OCR uses different labels, so alias JSON and ordered stage lists from the map path are part of correctness, not polish.

**Effective intents.** The strip and calendars read derived windows from `effectiveIntents.ts`, not raw `MemberSlotIntent` rows. `applyConflictIntents.ts` must apply the same rules when saving a resolution, especially for split and custom modes that touch two slots at once.

**Snapshot shape.** After the squad + schedule query, parallel Prisma reads fill ratings, comments, conflicts, and intents. JSON fields (walk matrix, custom windows on squad defaults) are parsed defensively. Mixing the viewer's intents with `allMemberSlotIntents` for Everyone's calendar means bugs show up as wrong colours, not type errors.

**Vision and Spotify.** Model output may be JSON inside markdown fences; unconfigured providers still need JSON errors (`vision_unconfigured`, etc.) so a routing 404 is not read as a failed scan. Spotify matching is fuzzy and rate-limited: sequential search, caps, skip weak hits rather than wrong tracks.
