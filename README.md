# Festival Squad (Clasher)

Cloud-first web app: **Next.js** UI and **`/api`** on the same origin, **PostgreSQL** (e.g. Neon) as source of truth. No passwords—each browser stores a **member secret**; squads are joined with a normal **`https://…/join/{token}`** link.

## Prerequisites

- Node 20+
- A Postgres `DATABASE_URL`
- Optional: `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` for poster/timetable scanning

## Setup

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL (and optional vision keys)

npx prisma db push
# or: npx prisma migrate dev

npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Create a squad, then open `/api/health` — you should see `{"ok":true}`.

## Production checks

1. **HTTPS same-origin** — In DevTools → Network, confirm API calls go to `https://<your-domain>/api/...` (not a stale absolute URL).
2. **`GET /api/health`** returns JSON `{ "ok": true }`.
3. **`POST /api/squads`** and **`POST /api/parse/lineup`** return JSON bodies or explicit API errors (e.g. `vision_unconfigured` with a message)—not an HTML 404 page mistaken for a scan failure.

## Deploy (e.g. Vercel)

**Live app:** [https://clasher-three.vercel.app](https://clasher-three.vercel.app) (production alias for this project).

1. Create a Vercel project from this repo (or use the existing **clasher** project under your team).
2. Set environment variables: `DATABASE_URL`, and optionally `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `VISION_PROVIDER`, `ANTHROPIC_MODEL`.
3. Build command: `npm run build` (runs `prisma generate` then `next build`).
4. After first deploy, run `npx prisma db push` (or migrations) against production DB from your machine, or use a CI migrate step.

### Automatic deploys on every push

**Option A (recommended):** In [Vercel](https://vercel.com) → **clasher** → **Settings** → **Git** → **Connect Git Repository**. Every push to the connected branch triggers a production or preview deployment (choose **Production Branch** = `main`).

**Option B (GitHub Actions):** This repo includes [`.github/workflows/vercel-production.yml`](.github/workflows/vercel-production.yml). Add a repository secret **`VERCEL_TOKEN`** ([create a token](https://vercel.com/account/tokens)). Each push to **`main`** runs `vercel deploy --prod`.

## Project layout

| Path | Role |
|------|------|
| `prisma/schema.prisma` | Squad, Member, Artist, Rating, Comment, ScheduleSlot, ConflictResolution, MemberSlotIntent |
| `src/server/festivalApp.ts` | Hono app mounted at `/api` |
| `src/app/api/[[...route]]/route.ts` | Catch-all forwarding to Hono |
| `src/app/api/health/route.ts` | Explicit health check |
| `src/app/api/parse/*/route.ts` | Explicit POST routes for vision |
| `src/context/ClasherContext.tsx` | Client session + snapshot |
| `src/lib/api.ts` | Fetch helpers (HTML 404 detection for routing issues) |

## Scripts

- `npm run dev` — Next dev server (Turbopack)
- `npm run build` — `prisma generate` + production build
- `npm run db:generate` / `npm run db:push` / `npm run db:migrate` — Prisma

## Leaving a squad

**Leave** clears the browser session only; server data is unchanged (no squad delete in v1).
