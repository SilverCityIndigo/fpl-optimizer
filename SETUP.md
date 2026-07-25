# FPL Lab — Season Setup & Data Syncing

This is the operational guide for keeping the app's data fresh. You do this
**once** to seed a new season, then it runs itself.

## Architecture (as actually deployed)

| Piece      | Where it runs                          |
|------------|----------------------------------------|
| Frontend   | Vercel — `fpl-optimizer-one.vercel.app`|
| Backend    | Render — `fpl-lab-backend.onrender.com`|
| Database   | Supabase (Postgres)                    |
| Data sync  | **GitHub Actions** (`.github/workflows/sync.yml`) |

## Why syncing moved out of the backend

The backend used to run an in-process `APScheduler` to sync every 2h/24h. On a
host that spins down when idle (Render free tier), that scheduler dies with the
process, so the jobs silently never ran — which is why the data only updated
when you synced by hand. The sync now runs on GitHub Actions, which:

- fires on a real cron regardless of whether Render is awake,
- writes to Supabase directly (so it also **keeps the free-tier DB from
  auto-pausing** — the original cause of the outage), and
- pulls current-season xG straight from the FPL API, so it auto-updates every
  run with no manual step.

## One-time setup

### 1. Add the database secret to GitHub

1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
2. Name: `DATABASE_URL`
3. Value: your Supabase connection string (Supabase dashboard → **Connect** →
   "Connection string" → URI; use the **Session/Direct** connection, not the
   transaction pooler, for a long-running migration).

### 2. Seed the new season

1. GitHub repo → **Actions → FPL Data Sync → Run workflow**
2. Mode: **full** → **Run workflow**

This runs the migration (adds new columns), pulls the 26/27 players/teams/
fixtures, seeds every returning player's underlying stats from their last PL
season, seeds new arrivals from Understat's other leagues, and computes
projections. Takes a few minutes (it fetches per-player history for ~540
players). Watch the run log for the ✅ summaries.

### 3. Verify

- `https://fpl-lab-backend.onrender.com/api/gameweek/current` → should show
  **Gameweek 1**, `"preseason": true`.
- Open the site → **Players** should list the 26/27 squad; **Transfers /
  Captain / Scout** should return projections.

That's it. From here the schedules take over.

## What runs automatically

| Schedule (UTC)      | Mode  | Does |
|---------------------|-------|------|
| Every 2 hours       | light | bootstrap (prices/form/xG) + fixtures + latest GW live stats + projections. Keeps Supabase awake. |
| Daily 05:30         | deep  | full per-player history + last-season & newcomer re-seeding + projections. |

Trigger any mode manually from **Actions → FPL Data Sync → Run workflow**.

## Manual fallback (optional)

The backend still exposes admin endpoints if you ever want to trigger a sync
without GitHub (they hit the same functions):

```bash
curl -X POST https://fpl-lab-backend.onrender.com/admin/sync         # light
curl -X POST https://fpl-lab-backend.onrender.com/admin/sync-history # history + seed
```

## Local run (optional)

```bash
cd backend
pip install -r requirements.txt
export DATABASE_URL="postgres://...your supabase uri..."
python -m data.fpl_fetcher full        # or: light | deep | migrate | projections
```

## How new-season projections work

Before anyone has played a 26/27 minute, projections are seeded:

- **Returning players** → their last completed PL season (FPL `history_past`),
  matched by player id. Reliable, no name-matching.
- **New arrivals from abroad** → Understat's La Liga / Serie A / Bundesliga /
  Ligue 1 / RPFL data, fuzzy-matched by name (`xg_source = 'understat_foreign'`).
  Best-effort: an unmatched newcomer just falls back to position/price priors.

As real minutes accumulate, `compute_projections` blends the live current-season
numbers in and the seed out (fully live by ~450 minutes played), so the tool is
useful on day one and self-corrects across the season.
