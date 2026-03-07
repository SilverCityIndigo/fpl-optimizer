# FPL Analyzer — Project Context

## Project Overview
A Fantasy Premier League analysis tool.
- Backend: Python + FastAPI (port 8000)
- Frontend: React + Vite (port 5173)
- Database: SQLite (backend/fpl.db)
- Data: Official FPL API (free, no key)
- Optimizer: PuLP linear programming

## Starting The Project (Every Time)

### Terminal 1 — Backend
cd backend
venv\Scripts\activate
uvicorn main:app --reload

### Terminal 2 — Frontend
cd frontend
npm run dev

### Then open browser to:
- http://localhost:5173 ← the app
- http://localhost:8000/docs ← API testing (optional)

### Weekly data sync (do this each gameweek):
cd backend
venv\Scripts\activate
python -m data.fpl_fetcher

## Project Structure
fpl-analyzer/
├── backend/
│   ├── main.py
│   ├── fpl.db
│   ├── api/
│   │   ├── players.py
│   │   ├── optimizer.py
│   │   └── gameweek.py
│   ├── data/
│   │   └── fpl_fetcher.py
│   └── services/
│       └── optimizer.py
└── frontend/
    └── src/
        ├── App.jsx
        ├── api.js
        └── pages/
            ├── Players.jsx
            ├── Transfers.jsx
            ├── Captain.jsx
            └── Differentials.jsx

## Features Built ✅
- Players page: card view with headshots, value ratings, form badges, position filter, sort, search
- Value rating system: Reliable, Elite Value, Good Value, Poor Value, Avoid, Injured
- Transfer recommendations: auto-import squad via FPL team ID, headshots on sell/buy cards
- Hit detector: -4 point analysis, multi-week plan banner
- Captain picker: fixture-adjusted rankings, FDR colour coding, projected captain points, next fixture
- Differential Scout: low-ownership high-form players by position, dynamic "why this pick" text, FDR, fixtures

## Value Rating Logic (Players.jsx)
Uses points_per_game / price (not total_points / price)
- Injured: status !== 'a' → shows on form badge, value label still shows normally
- Avoid: form < 2, OR price >= 8.0 && form < 4
- Reliable: ownership >= 30 && ptsPer >= 0.55 && form >= 4
- Elite Value: ptsPer >= 0.8 && form >= 4.5
- Good Value: ptsPer >= 0.6 && form >= 3.5
- Poor Value: ptsPer >= 0.4
- Avoid (fallback)

## Differential Scout Criteria
- ownership < 15%
- form >= 4.0
- points_per_game >= 3.5
- status = 'a' (available only)
- Top 5 per position, sorted by form DESC

## API Endpoints
GET  /api/players/              All players (filterable)
GET  /api/players/value         Best pts/£m players
GET  /api/players/differentials Scout page data (with fixtures + why text)
GET  /api/players/{id}/history  Per-player GW history
GET  /api/players/team/{id}     Import user squad by FPL team ID
GET  /api/optimizer/squad       Optimal 15-man squad
POST /api/optimizer/transfers   Transfer suggestions
POST /api/optimizer/captain     Captain recommendations
POST /api/optimizer/hit-analysis Hit detector
GET  /api/gameweek/current      Current GW info
GET  /api/gameweek/fdr-table    FDR for all teams

## Database Fields (players table)
id, code, web_name, full_name, team_id, position, price,
total_points, points_per_game, form, selected_by_percent,
minutes, goals_scored, assists, clean_sheets, bonus,
ict_index, news, chance_of_playing_next_round, status, updated_at

## Up Next 🔜
1. Price change tracker — needs transfers_in_event + transfers_out_event
   added to fpl_fetcher.py and players table first
2. Last synced indicator
3. Chip advisor
4. GW history sparklines
5. Mini-league tracker
6. Public deployment (Railway/Render backend, Vercel frontend)

## Key Design Decisions
- projected_points = exponential decay weighted avg of last 6 GWs
- Captain score = projected_points × FDR multiplier (FDR1=×1.3, FDR5=×0.7)
- Value = points_per_game / price (NOT total_points / price)
- Differentials: form gates everything — cold players never get positive labels
- Injured badge replaces form badge, value label still calculated normally
- FPL photo URL: https://resources.premierleague.com/premierleague/photos/players/110x140/p{code}.png

## Notes
- Always ensure (venv) visible in terminal before running Python commands
- Always stop uvicorn (Ctrl+C) before deleting fpl.db
- Run fpl_fetcher sync after each gameweek (usually Tue/Wed)
- LinkedIn post + README for launch documentation (not a homepage)