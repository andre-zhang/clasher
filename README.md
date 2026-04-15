# Clasher

## Inspiration

I love music festivals. The lineup drop, the colour-coded timetable PDF, the group chat that turns into fifty screenshots - all of it. I tried spreadsheets, notes apps, shared Google Docs, and a bunch of one-off festival apps. Some were pretty, but none of them felt like they were built for **how a group actually plans together**: who’s in for which act, where the overlaps are, and how long it takes to get from one stage to another.

---

## What It Does

- **Lineup**: artists on the bill, tier ratings (must / want / meh / skip), quick reactions, and a path to sync “hot” picks into what you care about on the schedule
- **Schedule**: multi-day, multi-stage timetable in a proper calendar grid: frozen stage headers, sticky time rail, edit/add/delete acts, optional **vision import** (poster or screenshot → draft slots) when you wire up OpenAI or Anthropic on the server
- **Clashes**: see where intents collide: same time, or “you could make both if you run” vs “you genuinely can’t” once **walk times** between stages are in play
- **Plans**: your ordered plan strip, per-slot plan windows, optional **walk matrix** between stages (defaults from stage order on a map, editable in Options), and a combined view of everyone’s day
- **Wallpaper export**: tall **9×16 PNG** lock-screen style day plans for you or the whole group (with optional “leave by …” hints when walk forces an early exit)
- **Next.js** app, **PostgreSQL** (e.g. Neon) as source of truth, **Prisma** schema for squads, members, artists, ratings, schedule slots, intents, resolutions, comments

---

## Challenges

### Festival time is not “a normal day”

Set times after midnight still belong to the **same festival day** as the afternoon. The app uses a single continuous timeline (afternoon → late night → after-midnight) so sorting, overlap math, and the calendar all agree. Sounds obvious until every import format and OCR line uses wall-clock strings and you have to normalise them without breaking real festivals’ weird edge cases.

### Walk times without lying to the user

Inter-stage minutes come from a matrix (or sensible defaults from stage order). Cap them, respect “walk times off”, show travel only when the calendar gap is actually tight, and still keep clash detection and PNG hints honest.

### OCR on real-world timetables

Promoters do not publish tidy CSVs. Vision has to read a **grid**: which column is which stage, which cell is which act, and what day label goes with it. The model will still hallucinate sometimes — the prompt keeps getting tighter.

### Dense UI that works on a phone

Many stages, many slots, drag-to-strip, sticky headers, scroll containers that must not paint over the nav, and enough tap targets that you can use it in a field with one hand. Getting **sticky** stage names and time labels to behave meant tracking down every ancestor `overflow` that accidentally broke `position: sticky`.

### Everyone’s truth in one snapshot

Each member has intents, plan windows, clash resolutions, and optional “personal plan only” strip slots. The server builds a **snapshot** the user can trust. Keeping that coherent as people join, rate, and re-order plans, without turning the app into a second spreadsheet engine, is ongoing.
