"""
FPL Squad Optimizer
Uses linear programming (PuLP) to find the mathematically optimal squad
given a budget and positional constraints — pure FPL points maximization.
"""

import sqlite3
from pulp import (
    LpProblem, LpMaximize, LpVariable, lpSum, LpBinary, value, PULP_CBC_CMD
)


def get_players_for_optimization(db_path: str = "fpl.db", gw_lookback: int = 6):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    c.execute("""
        SELECT
            p.id,
            p.code,
            p.web_name,
            p.team_id,
            p.position,
            p.price,
            p.total_points,
            p.points_per_game,
            p.form,
            p.minutes,
            p.status,
            p.chance_of_playing_next_round,
            t.short_name as team_name
        FROM players p
        JOIN teams t ON p.team_id = t.id
        WHERE p.status != 'u'
        AND p.minutes > 0
    """)

    columns = ["id", "code", "web_name", "team_id", "position", "price",
               "total_points", "points_per_game", "form", "minutes",
               "status", "chance_of_playing", "team_name"]

    players = [dict(zip(columns, row)) for row in c.fetchall()]

    for p in players:
        c.execute("""
            SELECT total_points, gameweek
            FROM player_gameweek_history
            WHERE player_id = ?
            ORDER BY gameweek DESC
            LIMIT ?
        """, (p["id"], gw_lookback))
        history = c.fetchall()

        if history:
            weights = [0.9 ** i for i in range(len(history))]
            weighted_pts = sum(h[0] * w for h, w in zip(history, weights))
            total_weight = sum(weights)
            p["projected_points"] = weighted_pts / total_weight
        else:
            p["projected_points"] = p["points_per_game"]

        chance = p["chance_of_playing"]
        if chance is not None and chance < 100:
            p["projected_points"] *= (chance / 100.0)

    conn.close()
    return players


def optimize_squad(
    budget: float = 100.0,
    db_path: str = "fpl.db",
    bench_weight: float = 0.1
):
    players = get_players_for_optimization(db_path)

    prob = LpProblem("FPL_Squad_Optimizer", LpMaximize)

    squad_vars = {p["id"]: LpVariable(f"squad_{p['id']}", cat=LpBinary) for p in players}
    start_vars = {p["id"]: LpVariable(f"start_{p['id']}", cat=LpBinary) for p in players}

    prob += lpSum(
        p["projected_points"] * start_vars[p["id"]] +
        p["projected_points"] * bench_weight * (squad_vars[p["id"]] - start_vars[p["id"]])
        for p in players
    )

    prob += lpSum(squad_vars[p["id"]] for p in players) == 15

    for pos, count in [("GKP", 2), ("DEF", 5), ("MID", 5), ("FWD", 3)]:
        pos_players = [p for p in players if p["position"] == pos]
        prob += lpSum(squad_vars[p["id"]] for p in pos_players) == count

    prob += lpSum(p["price"] * squad_vars[p["id"]] for p in players) <= budget

    team_ids = set(p["team_id"] for p in players)
    for team_id in team_ids:
        team_players = [p for p in players if p["team_id"] == team_id]
        prob += lpSum(squad_vars[p["id"]] for p in team_players) <= 3

    prob += lpSum(start_vars[p["id"]] for p in players) == 11

    for p in players:
        prob += start_vars[p["id"]] <= squad_vars[p["id"]]

    gkps = [p for p in players if p["position"] == "GKP"]
    defs = [p for p in players if p["position"] == "DEF"]
    mids = [p for p in players if p["position"] == "MID"]
    fwds = [p for p in players if p["position"] == "FWD"]

    prob += lpSum(start_vars[p["id"]] for p in gkps) == 1
    prob += lpSum(start_vars[p["id"]] for p in defs) >= 3
    prob += lpSum(start_vars[p["id"]] for p in mids) >= 2
    prob += lpSum(start_vars[p["id"]] for p in fwds) >= 1

    prob.solve(PULP_CBC_CMD(msg=0))

    squad = []
    for p in players:
        if value(squad_vars[p["id"]]) > 0.5:
            p["in_starting_11"] = value(start_vars[p["id"]]) > 0.5
            squad.append(p)

    squad.sort(key=lambda x: (not x["in_starting_11"], x["position"], -x["projected_points"]))

    total_cost = sum(p["price"] for p in squad)
    total_projected = sum(p["projected_points"] for p in squad if p["in_starting_11"])

    return {
        "squad": squad,
        "total_cost": round(total_cost, 1),
        "budget_remaining": round(budget - total_cost, 1),
        "projected_points": round(total_projected, 1),
        "status": "optimal"
    }


def suggest_transfers(
    current_squad_ids: list[int],
    budget_itb: float,
    free_transfers: int = 1,
    db_path: str = "fpl.db"
):
    players = get_players_for_optimization(db_path)
    player_map = {p["id"]: p for p in players}

    current_squad = [player_map[pid] for pid in current_squad_ids if pid in player_map]
    transfer_suggestions = []

    for sell_player in current_squad:
        sell_price = sell_player["price"]
        available_budget = budget_itb + sell_price

        candidates = [
            p for p in players
            if p["position"] == sell_player["position"]
            and p["id"] not in current_squad_ids
            and p["price"] <= available_budget
        ]

        for buy_player in sorted(candidates, key=lambda x: -x["projected_points"])[:5]:
            gain = buy_player["projected_points"] - sell_player["projected_points"]
            if gain > 0:
                transfer_suggestions.append({
                    "sell": sell_player,
                    "buy": buy_player,
                    "points_gain": round(gain, 2),
                    "cost_diff": round(buy_player["price"] - sell_price, 1)
                })

    transfer_suggestions.sort(key=lambda x: -x["points_gain"])
    return transfer_suggestions[:10]


def suggest_captain(current_squad_ids: list[int], db_path: str = "fpl.db"):
    players = get_players_for_optimization(db_path)
    player_map = {p["id"]: p for p in players}

    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    c.execute("""
        SELECT team_h, team_a, team_h_difficulty, team_a_difficulty
        FROM fixtures
        WHERE gameweek = (SELECT id FROM gameweeks WHERE is_next = 1 LIMIT 1)
    """)
    next_fixtures = c.fetchall()
    conn.close()

    fdr_map = {}
    fixture_map = {}  # team_id → fixture string
    
    conn2 = sqlite3.connect(db_path)
    c2 = conn2.cursor()
    c2.execute("SELECT id, short_name FROM teams")
    team_names = {row[0]: row[1] for row in c2.fetchall()}
    conn2.close()

    for team_h, team_a, fdh, fda in next_fixtures:
        fdr_map[team_h] = fdh
        fdr_map[team_a] = fda
        h_name = team_names.get(team_h, '?')
        a_name = team_names.get(team_a, '?')
        fixture_map[team_h] = f"{h_name} vs {a_name}"
        fixture_map[team_a] = f"{h_name} vs {a_name}"

    captain_options = []
    for pid in current_squad_ids:
        p = player_map.get(pid)
        if not p:
            continue

        fdr = fdr_map.get(p["team_id"], 3)
        fixture_multiplier = {1: 1.3, 2: 1.15, 3: 1.0, 4: 0.85, 5: 0.7}.get(fdr, 1.0)
        adjusted_score = p["projected_points"] * fixture_multiplier

        captain_options.append({
            **p,
            "fdr": fdr,
            "fixture": fixture_map.get(p["team_id"], "Unknown"),
            "fixture_multiplier": fixture_multiplier,
            "captain_score": round(adjusted_score, 2),
            "projected_captain_points": round(adjusted_score * 2, 2)
        })

    captain_options.sort(key=lambda x: -x["captain_score"])
    return captain_options


def analyze_hit_worthiness(
    current_squad_ids: list[int],
    budget_itb: float,
    free_transfers: int = 1,
    db_path: str = "fpl.db"
):
    players = get_players_for_optimization(db_path)
    player_map = {p["id"]: p for p in players}

    def get_best_transfers(n):
        suggestions = []
        temp_squad_ids = list(current_squad_ids)
        temp_budget = budget_itb
        used = []

        for _ in range(n):
            best = None
            for sell_player in [player_map[pid] for pid in temp_squad_ids if pid in player_map]:
                available = temp_budget + sell_player["price"]
                candidates = [
                    p for p in players
                    if p["position"] == sell_player["position"]
                    and p["id"] not in temp_squad_ids
                    and p["price"] <= available
                    and p["id"] not in [u["buy"]["id"] for u in used]
                ]
                for buy_player in sorted(candidates, key=lambda x: -x["projected_points"])[:5]:
                    gain = buy_player["projected_points"] - sell_player["projected_points"]
                    if gain > 0 and (best is None or gain > best["points_gain"]):
                        best = {
                            "sell": sell_player,
                            "buy": buy_player,
                            "points_gain": round(gain, 2),
                            "cost_diff": round(buy_player["price"] - sell_player["price"], 1)
                        }
            if best:
                suggestions.append(best)
                used.append(best)
                temp_squad_ids = [best["buy"]["id"] if pid == best["sell"]["id"] else pid for pid in temp_squad_ids]
                temp_budget -= best["cost_diff"]

        return suggestions

    one_transfer = get_best_transfers(1)
    two_transfers = get_best_transfers(2)

    gain_1 = sum(t["points_gain"] for t in one_transfer)
    gain_2 = sum(t["points_gain"] for t in two_transfers)
    gain_2_after_hit = gain_2 - 4

    if free_transfers >= 2:
        recommendation = "You have 2 free transfers — make both without penalty."
    elif gain_2_after_hit > gain_1 and gain_2_after_hit > 2:
        recommendation = f"✅ Take the hit. 2 transfers gains {round(gain_2, 2)} pts, minus 4 for the hit = {round(gain_2_after_hit, 2)} pts net. Worth it."
    elif gain_1 > 0:
        recommendation = f"❌ Don't take the hit. Best 1 transfer gains {round(gain_1, 2)} pts. Hit would cost more than it gains."
    else:
        recommendation = "No beneficial transfers found this week. Hold."

    return {
        "free_transfers": free_transfers,
        "best_1_transfer": one_transfer,
        "best_2_transfers": two_transfers,
        "gain_1_transfer": round(gain_1, 2),
        "gain_2_transfers": round(gain_2, 2),
        "gain_2_after_hit": round(gain_2_after_hit, 2),
        "take_hit": gain_2_after_hit > gain_1 and free_transfers < 2,
        "recommendation": recommendation,
        "multi_week_plan": [
            {
                "week": "This week",
                "action": f"Make {min(free_transfers, len(one_transfer))} free transfer(s)" if gain_1 > 0 else "Hold — no good transfers available",
                "transfers": one_transfer[:free_transfers]
            },
            {
                "week": "Next week",
                "action": "Bank the free transfer for a 2-transfer week" if gain_1 < 2 else "Use banked transfer on best available",
                "transfers": []
            }
        ]
    }