# Clasher

**Try it:** [https://clasher-three.vercel.app/](https://clasher-three.vercel.app/)

## Inspiration

I like music festivals. Planning them in a group chat full of screenshots and half-updated spreadsheets is not fun, and most apps are built for one person with a timetable, not for agreeing what to do when two sets collide or the walk between stages is too long.

Clasher is one shared festival: lineup, schedule, clashes, and plans in one place.

## What it does

- Create a group or join with a code, pick a name, and the app remembers you on that device.
- **Lineup:** rate artists (must / want / maybe / skip), comment, react. Type the bill or scan a poster and clean up the result.
- **Schedule:** multi-day timetable by stage; type it in or scan it. Notes per set, separate from lineup chat.
- **Clashes:** overlapping sets, or back-to-back sets you cannot make once walk times are on. Only pairs where someone in the group actually cares about both acts.
- **Resolve:** pick one, split time across both, set your own windows, or use a squad default. Group mode can align everyone until someone opts out.
- **Plans:** reorder your day, trim how long you stay at a set, personal strip vs shared "everyone" view.
- **Options:** walk times, festival map, stage walk matrix, map labels matched to timetable names.
- **Study playlist:** recent setlists for artists on your plan, preview, then Spotify playlist on your account.
- **Wallpaper:** tall PNG day plan, including leave-early hints when travel is tight.

## Tech stack

- Next.js 15, React 19, TypeScript, Tailwind; squad routes under `src/app/squad/[squadId]/*`
- Postgres + Prisma; Hono API at `src/server/festivalApp.ts` via `src/app/api/[[...route]]/route.ts`
- Bearer secret per member (no passwords); client state in `ClasherContext.tsx`, fetches in `src/lib/api.ts`
- One server **snapshot** per load (`src/server/snapshot.ts`): schedule, ratings, intents, conflicts, squad defaults
- Time: `timeHm.ts` (festival day from 1pm wall origin), `scheduleTimeNormalize.ts` for imports/OCR
- Clashes: `clash.ts`, `walkFeasibility.ts`; intents: `effectiveIntents.ts`, `applyConflictIntents.ts`
- Vision: `vision.ts` (OpenAI / Anthropic); setlist.fm + Spotify OAuth in `setlistPreview.ts`, `spotifyResolveUris.ts`
- Export: `planWallpaper.ts` shares timeline/walk logic with the schedule UI

## Challenges (implementation)

**Festival timeline.** Same `dayLabel` runs afternoon through after-midnight on one axis (`wallMinutesToFestivalTimeline`). Sort, overlap, calendar, and export must agree or clashes lie.

**Import normalisation.** OCR times need per-stage AM/PM guesses, post-midnight day fixes, and a few systematic repairs. One bad row poisons walk feasibility.

**Walk matrix vs stage names.** Matrix keys are timetable strings; map OCR uses different labels, so aliases matter.

**Effective intents.** UI reads derived windows, not raw `MemberSlotIntent` rows; server writes must match or the next snapshot disagrees with what the user just saved.

**Snapshot.** Parallel reads after the squad query; JSON walk matrix and custom windows parsed defensively. Wrong intent arrays show up as wrong colours on the group calendar.

**Vision / Spotify.** JSON from models may be fenced in markdown; errors must be JSON, not HTML 404s. Spotify search is fuzzy, sequential, and capped so we skip weak matches instead of wrong tracks.
