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

xG/xA data sourced from Understat. FPL data from the official Fantasy Premier League API.

## Data & Syncing

The app syncs data automatically in the background:
- **Every 2 hours** — player prices, form, transfer counts, ownership (via FPL bootstrap)
- **Every 24 hours** — xG/xA data from Understat

The **🔃 Sync button** in the nav bar triggers an immediate manual sync of prices, fixtures, and xG data. Note that gameweek history (used in the Analytics breakdowns) is synced separately via the admin endpoint and does not need to be run every gameweek — only when new stat columns are added.

To run a full local sync:
```bash
cd backend
python -c "from data.fpl_fetcher import full_sync; full_sync()"
```

## Tech Stack

- **Frontend:** React.js + Vite, deployed on Vercel
- **Backend:** Python + FastAPI, deployed on Railway
- **Database:** SQLite
- **Charts:** Chart.js + react-chartjs-2
- **Data Sources:** Official FPL REST API, Understat, understatapi

## About

Built by [SilverCityIndigo](https://github.com/SilverCityIndigo)

*Data sourced from the official Fantasy Premier League API and Understat.com*
