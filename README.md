# FPL Lab

A full-stack Fantasy Premier League analytics tool that goes beyond the official game's stats.

## Live App
https://fpl-optimizer-one.vercel.app

## Features

- **Transfer Recommendations** — data-driven suggestions ranked by projected points gain, with hit worthiness analysis
- **Captaincy Suggestions** — projection-based captain ranking with fixture difficulty weighting
- **Chip Advisor** — personalised chip recommendations with real chip availability detection via the FPL API
- **Differential Scout** — low-ownership players with strong underlying stats and favourable fixtures
- **Price Change Tracker** — transfer pressure monitoring for rising and falling players
- **Pitch View** — interactive pitch with per-player GW projected points and next fixture
- **Analytics — xG vs Goals** — scatter plot of all players by xG/90 vs actual goals/90. Search or click any player to highlight them, see their season xG stats, an over/underperforming insight tag, and a positional comparison bar showing how they rank vs peers
- **Analytics — Form Timeline** — GW-by-GW points chart for any player with a compare mode to overlay a second player. Includes a full gameweek breakdown table with position-aware columns:
  - **GKP:** Saves, xGC, Clean Sheet
  - **DEF:** Goals, Assists, xG, xA, Clean Sheet, Defcon, CBI (Clearances/Blocks/Interceptions)
  - **MID:** Goals, Assists, xG, xA, Clean Sheet, Defcon, Recoveries
  - **FWD:** Goals, Assists, xG, xA

## Projection Algorithm

Player projections are built from multiple components:
- Exponential decay form scoring (recent GW history, recency weighted)
- Form-adaptive xG/xA blending — low form respected as a warning signal, high form defers to underlying season stats
- Clean sheet probability modelled from team defensive rates and opponent attack strength
- Defensive contribution (defcon) likelihood from BPS history
- Minutes reliability factor from recent average minutes
- Bonus point estimation from historical averages
- Fixture difficulty multiplier applied last

At the start of a season, projections are seeded from the previous season (FPL
`history_past` for returning players, Understat's other leagues for new arrivals)
and blend into live current-season numbers as minutes accrue. In-season xG/xA
comes from the official FPL API; Understat is used only to seed newcomers.

## Data & Syncing

Syncing runs on **GitHub Actions** (`.github/workflows/sync.yml`), not inside
the backend — a host that sleeps when idle can't run an in-process scheduler.
The workflow runs the sync directly against Supabase, which also keeps the
free-tier database from auto-pausing.

- **Every 2 hours** — prices, form, transfer counts, ownership, current-season
  xG (all from the FPL bootstrap), latest gameweek stats, and projections.
- **Daily** — full per-player gameweek history + last-season / newcomer seeding.

Current-season xG/xA now comes straight from the FPL API (`expected_goals_per_90`
et al.), so it auto-updates with no scraping. Understat is used only to seed
players arriving from other leagues.

See **[SETUP.md](SETUP.md)** for one-time season setup (add the `DATABASE_URL`
secret, run the workflow once) and the manual admin endpoints.

To run a sync locally:
```bash
cd backend
export DATABASE_URL="postgres://...supabase..."
python -m data.fpl_fetcher full   # or: light | deep | migrate | projections
```

## Tech Stack

- **Frontend:** React.js + Vite, deployed on Vercel
- **Backend:** Python + FastAPI, deployed on Render
- **Database:** Supabase (Postgres)
- **Data sync:** GitHub Actions (cron)
- **Charts:** Chart.js + react-chartjs-2
- **Data Sources:** Official FPL REST API, Understat, understatapi

## About

Built by [SilverCityIndigo](https://github.com/SilverCityIndigo)

*Data sourced from the official Fantasy Premier League API and Understat.com*
