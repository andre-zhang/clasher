# Clasher

**Try it:** [https://clasher-three.vercel.app/](https://clasher-three.vercel.app/)

## Inspiration

I like music festivals. I like them less when the plan lives in fifty screenshots and nobody agrees which set we are actually running to. Spreadsheets and shared docs help a little, but they rarely show where the group disagrees, and they almost never answer whether two back-to-back sets are realistic once you factor in walking between stages.

Clasher is meant for that mess: one shared festival, one timetable everyone works from, and a place to work through overlaps instead of re-explaining them in chat every hour.

## What it does

- You land on a simple home screen and either start a new group or join with an invite-style code, pick a display name, and you are in. No separate accounts to manage; the app just remembers you on that device so you can pick up where you left off.

- **Lineup** is the bill: every artist your group cares about, with per-person ratings from "must see" down to "skip", short comments if you want to argue about a set, and quick reactions. You can type the bill in by hand, or point the app at a lineup graphic (poster, screenshot, whatever) and let it fill the list for you to clean up. There is also canned demo data if you want to explore without uploading anything.

- **Schedule** is the real timetable: days, stages, start and end times, tied back to artists on the lineup. You can maintain it manually or bring in a timetable image the same way as the lineup. Each set can have its own little notes (emoji or text) separate from the lineup chatter.

- **Clashes** is where the app tells you which pairs of sets actually fight each other. Sometimes that is the obvious case (two things at once). Sometimes two sets do not overlap on the clock but you still cannot do both once you account for walking between stages and the squad has turned that on. The list focuses on conflicts that matter to someone in the group (both artists rated strongly enough that the overlap is not ignorable noise).

- When you hit a clash you **resolve** it: pick one set and drop the other, split the time so you plan to catch part of each in order, draw your own "I am only here for this slice" windows, or lean on a default the squad saved for that pair. There is also a group mode where everyone follows the same default until they opt out. Resolving is meant to update what shows on your plan, not just tick a box and forget.

- **Plans** is your day in order: a strip you can reorder, optional "I am really only there for this window" inside a longer set, and a way to keep something on your personal calendar even when the logic around clashes gets fiddly. You can keep something just on your strip or fold into the shared "everyone" view, and you can reset your strip toward what the group agreed if you drifted.

- **Options** is squad-wide: turn walk times on or off, upload a festival map so stage order makes sense, tune how long walks are between stages (or let the map suggest starting values), and line up map labels with the stage names on the schedule when they do not match verbatim.

- On the lineup side you can build a **study playlist** from recent real-world setlists of the artists you are planning to see, preview what might land in it, connect your Spotify when you are ready, and spawn an actual playlist on your account.

- **Wallpaper export** gives you a tall phone-shaped image of a day plan, same information density as the schedule views, including a nudge when you need to leave early to make the next thing.

## Stack and implementation

The product is a Next.js 15 App Router app (React 19, TypeScript, Tailwind) with squad-scoped pages under `src/app/` from `/create` and `/join/[token]` through `/squad/[squadId]/*` for lineup, schedule, clashes, plans, options, and invite flows. Client state for who-you-are in the squad lives in `ClasherContext.tsx` with typed HTTP helpers in `src/lib/api.ts`.

Persistence is PostgreSQL behind Prisma 6 (`prisma/schema.prisma`). The HTTP API is a Hono app in `src/server/festivalApp.ts`, edge-exported through the catch-all route at `src/app/api/[[...route]]/route.ts`, so everything the client needs hits `/api/...` on the same origin. Members authenticate with a per-member random secret sent as a Bearer token; there is no password table, which keeps the model small but pushes correctness onto anything that mutates membership or secrets.

The client renders almost entirely from a **snapshot** assembled server-side (`src/server/snapshot.ts`): squad metadata, schedule rows, ratings, artist and slot-level comments, conflict resolutions, squad-wide clash defaults, each member's slot intents, and the viewing member's slice for personal UI, plus `allMemberSlotIntents` for combined calendars. That design avoids the client stitching five endpoints into one consistent picture, at the cost of making `buildSnapshot` a choke point where schema drift or JSON parsing mistakes show up as wrong colours on the group view.

**Time model.** Festival "same day" is not midnight-aligned. Wall times are normalised into a single monotonic axis per `dayLabel` with a fixed afternoon origin (`src/lib/timeHm.ts`), so late-night and after-midnight sets sort and overlap-check consistently with how the calendar draws. Imports and vision output go through `scheduleTimeNormalize.ts` (12-hour disambiguation scoped per stage, day-label fixes for post-midnight rows, a few OCR-specific repairs). If that layer lies, clash detection lies, quietly.

**Attendability.** `src/lib/walkFeasibility.ts` and `src/lib/clash.ts` share logic for "these two slots overlap in time" versus "they do not overlap but the gap is smaller than the walk matrix says you need between those stage names". Walk minutes are capped, symmetric lookup degrades sensibly, and the squad can disable walks entirely so the product still works at festivals where nobody trusts the numbers. Matrix keys are schedule stage strings; map-derived labels are bridged with aliases so vision and timetable naming do not fork the graph.

**Intents after conflicts.** Raw `MemberSlotIntent` rows are not what the UI reads. `src/lib/effectiveIntents.ts` merges intents with active resolutions and squad defaults (including split windows derived from slot bounds in `timeHm.ts`). Writes go through `src/server/applyConflictIntents.ts` inside the same transaction as the resolution row so pick/split/custom paths cannot leave the database in a state the snapshot builder would interpret differently from what the member just chose.

**Vision.** `src/server/vision.ts` wraps OpenAI and Anthropic behind `VISION_PROVIDER` (auto picks whichever is configured). Multipart image routes for lineup and schedule return structured JSON or stable machine-readable errors so a routing mistake is not mistaken for "the model failed".

**Setlists and Spotify.** setlist.fm feeds aggregation and budgeting in `setlistPreview.ts` / `setlistFmBudget.ts` / merge helpers; Spotify track resolution is deliberately sequential with backoff (`spotifyResolveUris.ts`) because search is fuzzy and rate-limited. OAuth for playlist creation stores refresh tokens on `Member` rows, signs callback state, and handles rotation when Spotify issues a new refresh token.

**Wallpaper.** `src/lib/planWallpaper.ts` and the schedule components reuse the same timeline and walk band logic as interactive views so export is not a second, divergent renderer.

### Challenges (implementation)

**Festival timeline vs wall clock.** Everything that cares about order (overlap tests, calendar layout, export) maps wall `HH:mm` through `wallMinutesToFestivalTimeline` so the same `dayLabel` covers afternoon through the next morning without treating midnight as a hard cut. The inverse mapping has to stay exact for labels and for any UI that edits plan windows in wall time.

**Normalising pasted or scanned times.** Vision returns strings that were never validated by a human typist. The normaliser has to guess AM/PM where posters omit it, without letting one stage's timeline steal context from another, and it has to relocate 00:xx rows to the previous festival day when that matches how the PDF labelled the night. A single bad row is enough to make a "tight changeover" look feasible when it is not.

**Walk matrix keys vs schedule copy.** The walk graph is keyed by names as they appear on slots. Timetables and map OCR rarely agree on spelling and ordering, so alias JSON and ordered stage lists from the map path are part of the correctness story, not polish.

**Effective intents vs persistence.** The client derives windows for display; the server must apply the same rules when resolving a clash or the next snapshot will disagree with the member's last action. Split and custom modes are the easy footguns because they touch two slot intents at once.

**Snapshot shape.** Parallel Prisma reads after the squad+schedule query keep latency predictable, but JSON fields (walk matrix, custom windows on squad defaults) need defensive parsing before they hit the wire. Mixing `memberSlotIntents` for the viewer with `allMemberSlotIntents` for everyone's calendar means any mistake in who sees which array shows up as a social bug, not a type error.

**Vision and error surfaces.** Models return JSON inside prose or fenced blocks sometimes. The parser accepts that, but unconfigured providers must still return JSON errors (`vision_unconfigured`, and friends) so the client's error UI does not confuse an HTML 404 with a bad image.

**Setlist titles to Spotify URIs.** String-to-track matching is inherently lossy. The pipeline prefers skipping weak matches over polluting the playlist, interleaves fairly across artists, and caps how many URIs get resolved per run so a large lineup does not hammer Spotify into hard rate limits.
