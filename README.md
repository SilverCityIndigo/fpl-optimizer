# fpl-optimizer
A Fantasy Premier League squad optimizer and points prediction engine

## Overview

**fpl-optimizer** is a Python data analysis tool that helps you maximise your Fantasy Premier League (FPL) points by:

- 📊 **Predicting player points** using a multi-factor model: form, season stats, Opta ICT index, expected goals (xG), expected assists (xA), and fixture difficulty
- 🏆 **Optimizing your squad** using Integer Linear Programming (ILP) to find the 15-player combination that maximises expected points within the £100m budget and all official FPL rules
- ⚽ **Recommending a captain** and vice-captain pick, including differential options for rank-gaining plays
- 🃏 **Advising chip usage** (Wildcard, Free Hit, Triple Captain, Bench Boost) based on gameweek context, double/blank gameweeks, and squad health
- 🔄 **Suggesting transfers** that improve your squad's expected output, accounting for free transfers and hit cost

Data is pulled live from the **official FPL public API** — no credentials required.

---

## Points Prediction Model

The model blends five signals for each player:

| Signal | Description |
|---|---|
| **Form** | Rolling average points over the last 4–5 gameweeks (FPL-provided) |
| **Points per game** | Season-long average (FPL-provided) |
| **Opta ICT Index** | Influence + Creativity + Threat composite from Opta |
| **xG / xA** | Expected goals and assists (Opta data via FPL API) |
| **Fixture difficulty** | FDR (1=easy → 5=hard) multiplier adjusting the base prediction |

The prediction is then multiplied by the player's **availability probability** (0–100% based on injury/suspension status) to produce an *expected* points figure.

### FPL Points System (2024/25)

| Event | GKP | DEF | MID | FWD |
|---|---|---|---|---|
| 90+ min played | +2 | +2 | +2 | +2 |
| Goal scored | +6 | +6 | +5 | +4 |
| Assist | +3 | +3 | +3 | +3 |
| Clean sheet | +4 | +4 | +1 | 0 |
| Every 3 saves (GKP) | +1 | — | — | — |
| Every 2 goals conceded | −1 | −1 | 0 | 0 |
| Yellow card | −1 | −1 | −1 | −1 |
| Red card | −3 | −3 | −3 | −3 |

---

## Squad Optimizer Constraints

The ILP optimizer respects all official FPL rules:

- **Budget**: ≤ £100m (configurable)
- **Squad size**: exactly 15 players
  - 2 goalkeepers, 5 defenders, 5 midfielders, 3 forwards
- **Club limit**: maximum 3 players from any single Premier League club
- **Starting XI**: exactly 11 players in a valid formation
  - 1 GKP, ≥3 DEF, ≥2 MID, ≥1 FWD

---

## Installation

```bash
# Clone the repository
git clone https://github.com/SilverCityIndigo/fpl-optimizer.git
cd fpl-optimizer

# Install dependencies
pip install -r requirements.txt

# Install the package (editable mode for development)
pip install -e .
```

**Requirements**: Python 3.10+, `requests`, `pandas`, `pulp`

---

## Usage

### Command-line Interface

```bash
# Compute the optimal squad from scratch (fetches live data)
fpl-optimizer squad

# Show top 20 players by expected points
fpl-optimizer top --n 20

# Filter by position
fpl-optimizer top --n 10 --position MID

# Captain & vice-captain recommendation
fpl-optimizer captain

# Chip advice (specify which chips you've already used)
fpl-optimizer chips --used wildcard

# Transfer suggestions (1 free transfer)
fpl-optimizer transfers --ft 1 --max 2
```

### Python API

```python
from fpl_optimizer.service import FPLService

# Load live data from the FPL API
svc = FPLService()
svc.load()

print(f"Current gameweek: {svc.current_gameweek}")

# --- Optimal squad ---
squad = svc.optimal_squad()
print(squad.display())

# --- Top players ---
for p in svc.top_players(n=10, position="MID"):
    print(p.display())

# --- Captain pick ---
rec = svc.captain_pick(squad.starting_xi)
print(rec.display())

# --- Chip advice ---
advice = svc.chip_advice(chips_used={"wildcard"})
print(advice.display())

# --- Transfer suggestions (given your current squad) ---
plan, sell_candidates = svc.transfer_plan(
    current_squad=squad.squad,
    free_transfers=1,
    max_transfers=2,
)
print(plan.display())
for sc in sell_candidates:
    print(sc.display())
```

---

## Project Structure

```
fpl_optimizer/
├── data/
│   └── fetcher.py            # FPL public API client with in-memory cache
├── models/
│   └── player.py             # Player, Team, Fixture, GameweekStats dataclasses
├── analysis/
│   ├── fixture_analyzer.py   # Fixture difficulty ratings & DGW/BGW detection
│   └── points_predictor.py   # Expected-points model (form + xG/xA + FDR)
├── optimizer/
│   └── squad_optimizer.py    # ILP squad & transfer optimizer (PuLP)
├── recommendations/
│   ├── captain.py            # Captain & vice-captain scorer
│   ├── chips.py              # Chip advisor (Wildcard, FH, TC, BB)
│   └── transfers.py          # Transfer plan + sell-candidate ranker
├── service.py                # High-level orchestration layer
└── cli.py                    # Command-line interface

tests/
├── test_fetcher.py
├── test_player_model.py
├── test_fixture_analyzer.py
├── test_points_predictor.py
├── test_squad_optimizer.py
├── test_captain.py
└── test_chips.py
```

---

## Running Tests

```bash
pytest tests/ -v
```

---

## Key Design Decisions

- **FPL API only**: Uses the official FPL REST API (`fantasy.premierleague.com/api`), which is free and publicly available. No third-party data subscriptions needed.
- **xG/xA from Opta**: These metrics are embedded in the FPL API response (`expected_goals`, `expected_assists`) and come from Opta, a leading sports analytics provider.
- **ILP optimizer**: PuLP's CBC solver guarantees a globally optimal squad selection given the constraints — no heuristics or greedy approaches.
- **Fixture-aware predictions**: A FDR adjustment multiplier means the model naturally prefers players with easy upcoming fixtures.
- **Chip heuristics**: Chip recommendations are based on well-known FPL community heuristics (DGW timing for Triple Captain, blank GW for Free Hit, etc.) combined with model output.

---

## Limitations & Future Work

- The points prediction model is statistical and cannot account for manager decisions (rotation, formation changes, tactical shifts).
- Wildcard timing is complex and partially subjective — the advisor provides a signal but the final call requires FPL community context.
- Adding historical gameweek-by-gameweek model backtesting would allow calibration of prediction weights.
- A web frontend (e.g. FastAPI + React) could provide a richer interactive experience.

