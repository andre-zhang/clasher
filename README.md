# Clasher

## Inspiration

I love festivals. The lineup drop, the colour-coded timetable PDF, the group chat that turns into fifty screenshots and “who’s at what stage?” — all of it. I tried spreadsheets, notes apps, shared Google Docs, and a bunch of one-off festival apps. Some were pretty, but none of them felt like they were built for **how a squad actually plans together**: who’s in for which act, where the real overlaps are, and how long it takes to leg it from one stage to another when the schedule is tight.

Nothing out there felt comparable for that whole loop. So I built Clasher.

---

## What It Does

- **Squads without passwords** — you join with a normal `https://…/join/{token}` link; your browser keeps a member secret so you stay signed in on that device
- **Lineup** — artists on the bill, tier ratings (must / want / meh / skip), quick reactions, and a path to sync “hot” picks into what you care about on the schedule
- **Schedule** — multi-day, multi-stage timetable in a proper calendar grid: frozen stage headers, sticky time rail, edit/add/delete acts, optional **vision import** (poster or screenshot → draft slots) when you wire up OpenAI or Anthropic on the server
- **Clashes** — see where intents collide: same time, or “you could make both if you run” vs “you genuinely can’t” once **walk times** between stages are in play
- **Plans** — your ordered plan strip, per-slot plan windows, optional **walk matrix** between stages (defaults from stage order on a map, editable in Options), and a combined view of everyone’s day
- **Walk-aware UI** — light travel bands on the grid when the gap between acts is tight enough to matter; feasibility checks so the tool matches reality on the ground
- **Wallpaper export** — tall **9×16 PNG** lock-screen style day plans for you or the whole group (with optional “leave by …” hints when walk forces an early exit)
- **Cloud-shaped, not cloud-vague** — **Next.js** app, **PostgreSQL** (e.g. Neon) as source of truth, **Prisma** schema for squads, members, artists, ratings, schedule slots, intents, resolutions, comments

---

## Challenges

### Festival time is not “a normal day”

Set times after midnight still belong to the **same festival day** as the afternoon. The app uses a single continuous timeline (afternoon → late night → after-midnight) so sorting, overlap math, and the calendar all agree. Sounds obvious until every import format and OCR line uses wall-clock strings and you have to normalise them without breaking real festivals’ weird edge cases.

### Walk times without lying to the user

Inter-stage minutes come from a matrix (or sensible defaults from stage order). Cap them, respect “walk times off”, show travel only when the calendar gap is actually tight, and still keep clash detection and PNG hints honest. Small rules; lots of branching.

### OCR on real-world timetables

Promoters do not publish tidy CSVs. Vision has to read a **grid**: which column is which stage, which cell is which act, and what day label goes with it. The model will still hallucinate sometimes — the prompt keeps getting tighter — but the product also has **first-class editing** so a bad import is fixable in the UI, not a dead end.

### Dense UI that works on a phone

Many stages, many slots, drag-to-strip, sticky headers, scroll containers that must not paint over the nav, and enough tap targets that you can use it in a field with one hand. Getting **sticky** stage names and time labels to behave meant tracking down every ancestor `overflow` that accidentally broke `position: sticky`.

### Everyone’s truth in one snapshot

Each member has intents, plan windows, clash resolutions, and optional “personal plan only” strip slots. The server builds a **snapshot** the client can trust. Keeping that coherent as people join, rate, and re-order plans — without turning the app into a second spreadsheet engine — is ongoing work.

---

## Running it

**Stack:** Node 20+, Postgres `DATABASE_URL`, optional `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` for lineup/schedule image parsing.

```bash
cp .env.example .env
# Set DATABASE_URL (and optional vision keys)

npx prisma db push
# or: npx prisma migrate dev

npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Create a squad, then hit **`GET /api/health`** — you should see `{"ok":true}`.

### Production checks

1. **HTTPS same-origin** — In DevTools → Network, confirm API calls go to `https://<your-domain>/api/...`.
2. **`GET /api/health`** returns `{ "ok": true }`.
3. **`POST /api/squads`** and **`POST /api/parse/lineup`** (or `/parse/schedule`) return JSON or explicit errors like `vision_unconfigured` — not an HTML 404 mistaken for a scan failure.

### Deploy (e.g. Vercel)

**Example production:** [https://clasher-three.vercel.app](https://clasher-three.vercel.app).

1. New Vercel project from this repo; set `DATABASE_URL`, optionally `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `VISION_PROVIDER`, `ANTHROPIC_MODEL`.
2. Build: `npm run build` (runs `prisma generate` then `next build`).
3. After first deploy, run `npx prisma db push` (or migrations) against the production DB, or automate that in CI.

**Auto-deploy on push:** Vercel → Git → connect the repo (production branch `main`). Optionally use [`.github/workflows/vercel-production.yml`](.github/workflows/vercel-production.yml) with a `VERCEL_TOKEN` secret.

### Project layout (short)

| Path | Role |
|------|------|
| `prisma/schema.prisma` | Squads, members, artists, ratings, schedule, intents, resolutions, comments |
| `src/server/festivalApp.ts` | Hono app mounted at `/api` |
| `src/app/api/[[...route]]/route.ts` | Catch-all to Hono |
| `src/context/ClasherContext.tsx` | Client session + group snapshot |
| `src/lib/api.ts` | Typed fetch helpers |

### Scripts

- `npm run dev` — Next dev (Turbopack)
- `npm run build` — Prisma generate + production build
- `npm run db:generate` / `db:push` / `db:migrate` — Prisma

**Leaving a squad** clears the browser session only; server data is unchanged (no squad delete in v1).
