# Eightcore — Performance

The Phase 4 target: a list with 1,000 tasks renders in under 1.5 s locally.

## How to measure

```bash
npm run db:seed          # demo workspace and users (development only)
npm run perf:seed        # project PERF: one list with 1,000 tasks + 200 subtasks (re-creates it each run)
npm run build && npx next start -p 3000
node scripts/perf/measure-pages.mjs /w/demo/l/<list id printed by perf:seed>
npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/perf/time-queries.ts   # database work only
```

`PERF_TASKS=5000 npm run perf:seed` makes a bigger list. Never run the seeds against Supabase: both refuse `NODE_ENV=production`, and they only touch the `demo` workspace.

## Results (2026-10-29, production build, local Postgres, median of 3 loads)

| Page (1,000 tasks + 200 subtasks) | Server | Fully loaded | HTML |
|---|---|---|---|
| List | 0.6 s | **1.1 s** | 2.2 MB |
| List, subtasks expanded | 0.5 s | 1.2 s | 2.7 MB |
| Board | 0.4 s | 1.0 s | 1.8 MB |
| Calendar | 0.2 s | 0.4 s | 0.9 MB |
| All tasks | 0.2 s | 0.5 s | 1.1 MB |
| Search | 0.1 s | 0.3 s | 0.6 MB |
| Dashboard | 0.08 s | 0.2 s | 0.1 MB |
| Task page | 0.07 s | 0.2 s | 0.08 MB |
| Opening a task from the list | | 1.5 s | |

Database work for the list (all queries together): about 60 ms. The rest is rendering.

## What made the difference

Before: the list sent every row (6.5 MB, 2.6 s; opening a task took 3.6 s).

- **Group pages:** each status group shows its first 30 tasks; "Show all N tasks" loads the rest (`?all=<status id>`).
- **Collapsed groups send nothing:** done and cancelled groups start collapsed, and their tasks load when first opened (`?open=<status id>`).
- **"Closed" statuses** (e.g. Completed) are hidden unless the Closed toggle is on.

## Known follow-ups

- The Board still renders every card (1.8 MB at 1,000 tasks). A per-column "Show more" like the list's would halve it.
- Hosted numbers are slower than local (serverless cold starts, the database across the network). Re-measure on the production host in Phase 8.
