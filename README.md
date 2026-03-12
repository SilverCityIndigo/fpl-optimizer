# FPL Lab

A full-stack Fantasy Premier League analytics tool that goes beyond 
the official game's stats.

## Live App
https://fpl-optimizer-one.vercel.app

## Features
- **Transfer Recommendations** — data-driven suggestions ranked by 
  projected points gain, with hit worthiness analysis
- **Captaincy Suggestions** — projection-based captain ranking with 
  fixture difficulty weighting
- **Chip Advisor** — personalized chip recommendations with real 
  chip availability detection via the FPL API
- **Differential Scout** — low-ownership players with strong 
  underlying stats and favourable fixtures
- **Price Change Tracker** — transfer pressure monitoring for 
  rising and falling players
- **Pitch View** — interactive pitch with per-player GW projected 
  points and next fixture

## Projection Algorithm
Player projections are built from multiple components:
- Exponential decay form scoring (recent GW history, recency weighted)
- Form-adaptive xG/xA blending — low form respected as a warning 
  signal, high form defers to underlying season stats
- Clean sheet probability modelled from team defensive rates and 
  opponent attack strength
- Defensive contribution (defcon) likelihood from BPS history
- Minutes reliability factor from recent average minutes
- Bonus point estimation from historical averages
- Fixture difficulty multiplier applied last

xG/xA data sourced from Understat. FPL data from the official 
Fantasy Premier League API.

## Tech Stack
- **Frontend:** React.js + Vite, deployed on Vercel
- **Backend:** Python + FastAPI, deployed on Railway
- **Database:** SQLite
- **Data Sources:** Official FPL REST API, Understat

## Data
The app requires a synced local database. Run the fetcher to 
populate:
```bash
python backend/services/fpl_fetcher.py
```

*Data sourced from the official Fantasy Premier League API and 
Understat.com*
