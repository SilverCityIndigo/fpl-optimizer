"""
FPL Squad Optimizer
Uses linear programming (PuLP) to find the mathematically optimal squad
given a budget and positional constraints — pure FPL points maximization.

xG blending: for MID/FWD with 450+ minutes, projected_points is a weighted
blend of exponential-decay form (65%) and xGI/90 signal (35%).
GKPs and DEFs always use pure form — their xG signal is too sparse.
"""

import sqlite3
from pulp import (
    LpProblem, LpMaximize, LpVariable, lpSum, LpBinary, value, PULP_CBC_CMD
)


def get_players_for_optimization(db_path: str = "fpl.db", gw_lookback: int = 6):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    # Now includes xg_per90, xa_per90, xgi_per90
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
            t.short_name as team_name,
            COALESCE(p.xg_per90,  0.0) as xg_per90,
            COALESCE(p.xa_per90,  0.0) as xa_per90,
            COALESCE(p.xgi_per90, 0.0) as xgi_per90
        FROM players p
        JOIN teams t ON p.team_id = t.id
        WHERE p.status != 'u'
        AND p.minutes > 0
    """)

    columns = ["id", "code", "web_name", "team_id", "position", "price",
               "total_points", "points_per_game", "form", "minutes",
               "status", "chance_of_playing", "team_name",
               "xg_per90", "xa_per90", "xgi_per90"]

    players = [dict(zip(columns, row)) for row in c.fetchall()]

    # Fetch next fixture FDR for each team
    c.execute("""
        SELECT team_h, team_a, team_h_difficulty, team_a_difficulty
        FROM fixtures
        WHERE gameweek = (SELECT id FROM gameweeks WHERE is_next = 1 LIMIT 1)
    """)
    fdr_map = {}
    for team_h, team_a, fdh, fda in c.fetchall():
        fdr_map[team_h] = fdh
        fdr_map[team_a] = fda

    fdr_multipliers = {1: 1.20, 2: 1.10, 3: 1.00, 4: 0.90, 5: 0.80}

    for p in players:
        # ── Step 1: exponential-decay form score (existing logic) ──────────
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
            decay_score = weighted_pts / total_weight
        else:
            decay_score = p["points_per_game"]

        # ── Step 2: blend in xGI/90 for attacking players ─────────────────
        p["projected_points"] = _blend_xg(p, decay_score)

        # ── Step 3: injury/availability discount ──────────────────────────
        chance = p["chance_of_playing"]
        if chance is not None and chance < 100:
            p["projected_points"] *= (chance / 100.0)

        # ── Step 4: fixture difficulty multiplier ─────────────────────────
        fdr = fdr_map.get(p["team_id"], 3)
        p["projected_points"] *= fdr_multipliers.get(fdr, 1.0)
        p["fdr"] = fdr

    conn.close()
    return players


def _blend_xg(player: dict, decay_score: float, xgi_weight: float = 0.6) -> float:
    """
    Blend exponential-decay form with xGI/90 for a more stable projection.

    Rules:
    - Only applied to MID (position=3 in FPL, stored as "MID") and FWD
    - Player must have 450+ minutes for xG signal to be meaningful
    - If no xG data (xgi_per90 == 0), falls back to pure decay_score
    - GKP and DEF always use pure decay_score

    Scaling logic:
    - A MID scoring 0.4 xGI/90 → ~1 goal or 2 assists per 5 games
      → roughly 5 FPL pts per goal * 0.4 = 2.0 pts/game from xGI alone
    - We use pts_per_xgi to convert the xGI/90 rate into an approximate
      FPL points-per-game equivalent, then blend at 35% weight.
    """
    position  = player.get("position", "")
    minutes   = float(player.get("minutes") or 0)
    xgi_per90 = float(player.get("xgi_per90") or 0)

    use_xg = (
        position in ("MID", "FWD")
        and minutes >= 450
        and xgi_per90 > 0
    )

    if not use_xg:
        return round(decay_score, 3)

    # Conservative FPL points per unit of xGI/90
    pts_per_xgi = 5.0 if position == "MID" else 4.5  # MID goal = 5pts, FWD = 4pts
    xg_signal = xgi_per90 * pts_per_xgi

    blended = (1 - xgi_weight) * decay_score + xgi_weight * xg_signal
    return round(blended, 3)


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
                    "sell": {**sell_player,
                             "xg_per90":  sell_player.get("xg_per90", 0),
                             "xa_per90":  sell_player.get("xa_per90", 0),
                             "xgi_per90": sell_player.get("xgi_per90", 0)},
                    "buy":  {**buy_player,
                             "xg_per90":  buy_player.get("xg_per90", 0),
                             "xa_per90":  buy_player.get("xa_per90", 0),
                             "xgi_per90": buy_player.get("xgi_per90", 0)},
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
    fixture_map = {}

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


def analyze_chips(
    current_squad_ids: list[int],
    db_path: str = "fpl.db"
):
    players = get_players_for_optimization(db_path)
    player_map = {p["id"]: p for p in players}

    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    c.execute("SELECT id FROM gameweeks WHERE is_next = 1 LIMIT 1")
    next_gw_row = c.fetchone()
    if not next_gw_row:
        return {"error": "No upcoming gameweek found"}
    next_gw = next_gw_row[0]

    c.execute("""
        SELECT team_h, team_a, team_h_difficulty, team_a_difficulty, gameweek
        FROM fixtures
        WHERE gameweek BETWEEN ? AND ?
    """, (next_gw, next_gw + 4))
    fixtures = c.fetchall()
    conn.close()

    fdr_by_team = {}
    for team_h, team_a, fdh, fda, gw in fixtures:
        if team_h not in fdr_by_team:
            fdr_by_team[team_h] = []
        if team_a not in fdr_by_team:
            fdr_by_team[team_a] = []
        fdr_by_team[team_h].append(fdh)
        fdr_by_team[team_a].append(fda)

    squad = [player_map[pid] for pid in current_squad_ids if pid in player_map]
    if not squad:
        return {"error": "Squad not found"}

    gkps = sorted([p for p in squad if p["position"] == "GKP"], key=lambda x: -x["projected_points"])
    outfield = sorted([p for p in squad if p["position"] != "GKP"], key=lambda x: -x["projected_points"])

    starting_11 = [gkps[0]] + outfield[:10] if gkps else outfield[:11]
    bench = [gkps[1]] + outfield[10:] if len(gkps) > 1 else outfield[10:]

    avg_starting_pts = sum(p["projected_points"] for p in starting_11) / len(starting_11) if starting_11 else 0
    avg_bench_pts = sum(p["projected_points"] for p in bench) / len(bench) if bench else 0

    squad_fdrs = [fdr_by_team.get(p["team_id"], [3])[0] for p in starting_11]
    avg_fdr_next = sum(squad_fdrs) / len(squad_fdrs) if squad_fdrs else 3

    squad_avg_fdrs_5gw = []
    for p in starting_11:
        fdrs = fdr_by_team.get(p["team_id"], [3, 3, 3, 3, 3])
        squad_avg_fdrs_5gw.append(sum(fdrs) / len(fdrs))
    avg_fdr_5gw = sum(squad_avg_fdrs_5gw) / len(squad_avg_fdrs_5gw) if squad_avg_fdrs_5gw else 3

    captain_options = suggest_captain(current_squad_ids, db_path)
    top_captain = captain_options[0] if captain_options else None

    tc_score = top_captain["captain_score"] if top_captain else 0
    tc_fdr = top_captain.get("fdr", 3) if top_captain else 3
    tc_recommended = tc_score >= 8 and tc_fdr <= 2
    tc_reason = (
        f"✅ {top_captain['web_name']} is your standout captain with a score of {round(tc_score,1)} "
        f"and faces an {'easy' if tc_fdr <= 2 else 'medium'} fixture (FDR {tc_fdr}). "
        f"Projected TC points: {round(tc_score * 3, 1)}."
        if tc_recommended else
        f"❌ No standout TC opportunity. Your best captain ({top_captain['web_name'] if top_captain else 'N/A'}) "
        f"has a score of {round(tc_score,1)} — not exceptional enough to triple up."
    )

    bb_recommended = avg_bench_pts >= 4.5
    bb_reason = (
        f"✅ Your bench averages {round(avg_bench_pts,1)} projected pts — strong enough to boost. "
        f"Bench players: {', '.join(p['web_name'] for p in bench)}."
        if bb_recommended else
        f"❌ Your bench averages only {round(avg_bench_pts,1)} projected pts. "
        f"Not worth activating Bench Boost with this bench quality."
    )

    wc_recommended = avg_starting_pts < 5.0 and avg_fdr_5gw <= 2.8
    wc_reason = (
        f"✅ Your starting 11 averages {round(avg_starting_pts,1)} projected pts — below optimal. "
        f"With a favorable 5-GW run ahead (avg FDR {round(avg_fdr_5gw,1)}), now is a good time to wildcard."
        if wc_recommended else
        f"❌ Wildcard not recommended. Starting 11 averages {round(avg_starting_pts,1)} pts "
        f"and upcoming FDR is {round(avg_fdr_5gw,1)} — not compelling enough to burn your wildcard."
    )

    fh_recommended = avg_fdr_next >= 3.8
    fh_reason = (
        f"✅ Your squad faces a tough average FDR of {round(avg_fdr_next,1)} this gameweek. "
        f"Free Hit lets you field a temporary squad optimized for this week only."
        if fh_recommended else
        f"❌ Free Hit not needed. Your squad's average FDR this week is {round(avg_fdr_next,1)} — manageable."
    )

    return {
        "squad_summary": {
            "avg_starting_pts": round(avg_starting_pts, 1),
            "avg_bench_pts": round(avg_bench_pts, 1),
            "avg_fdr_next_gw": round(avg_fdr_next, 1),
            "avg_fdr_5gw": round(avg_fdr_5gw, 1),
        },
        "chips": {
            "triple_captain": {
                "recommended": tc_recommended,
                "reason": tc_reason,
                "top_captain": top_captain["web_name"] if top_captain else None,
                "projected_points": round(tc_score * 3, 1) if top_captain else 0
            },
            "bench_boost": {
                "recommended": bb_recommended,
                "reason": bb_reason,
                "avg_bench_pts": round(avg_bench_pts, 1)
            },
            "wildcard": {
                "recommended": wc_recommended,
                "reason": wc_reason,
                "avg_starting_pts": round(avg_starting_pts, 1)
            },
            "free_hit": {
                "recommended": fh_recommended,
                "reason": fh_reason,
                "avg_fdr_next_gw": round(avg_fdr_next, 1)
            }
        }
    }
