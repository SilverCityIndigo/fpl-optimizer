"""
FPL Squad Optimizer — Postgres version.

Two responsibilities:

1. ``compute_projections`` — the projection *algorithm*. Runs once per data
   sync (called by data.fpl_fetcher.sync_projections), loads everything it needs
   in a handful of bulk queries (no per-player round-trips), and returns each
   eligible player's projected points. The result is stored on the players table.

2. ``get_players_for_optimization`` — the read path used by the API. It just
   SELECTs the precomputed ``projected_points``, so transfer/captain/chip
   endpoints and the team import respond in a single fast query instead of
   recomputing the whole model on every request.

Projections blend a player's recent-form points decay with their underlying
xG/xA signal. Before a player has 26/27 minutes, the underlying signal and a
points baseline come from a pre-season "seed" (last PL season for returners,
Understat foreign leagues for new arrivals); as real minutes accrue the live
current-season numbers blend in and the seed blends out.
"""

import os
import psycopg2
from pulp import (
    LpProblem, LpMaximize, LpVariable, lpSum, LpBinary, value, PULP_CBC_CMD
)

CS_PTS = {"GKP": 4, "DEF": 4, "MID": 1, "FWD": 0}
DEFCON_PTS = 2
BPS_DEFCON_THRESHOLD = {"DEF": 10, "MID": 12}

GW_LOOKBACK = 6
# Current-season minutes at which we fully trust live numbers over the seed.
BLEND_FULL_MINUTES = 450.0


def get_db():
    return psycopg2.connect(os.environ["DATABASE_URL"])


# --------------------------------------------------------------------------- #
# Projection algorithm (heavy — runs at sync time, bulk-loaded)               #
# --------------------------------------------------------------------------- #

def _form_adaptive_xg_weight(form: float, position: str) -> float:
    form = max(0.0, min(10.0, float(form or 0)))
    if position == "DEF":
        return round(0.20 + (form / 10.0) * 0.40, 3)
    return round(0.35 + 0.50 * ((form / 10.0) ** 0.6), 3)


def _position_xg_signal(position: str, xg90: float, xa90: float) -> float:
    if position == "DEF":
        return xa90 * 3.0
    if position == "MID":
        return xg90 * 5.0 + xa90 * 3.0
    if position == "FWD":
        return xg90 * 4.0 + xa90 * 3.0
    return 0.0  # GKP handled separately


def _preseason_minutes_factor(sample_minutes: float) -> float:
    """Rough starter-likelihood from a full-season minutes tally, used before
    the player has current-season history to average."""
    m = float(sample_minutes or 0)
    if m >= 2200:
        return 1.0
    if m >= 1200:
        return 0.8
    if m >= 500:
        return 0.6
    if m > 0:
        return 0.4
    return 0.3


def compute_projections(gw_lookback: int = GW_LOOKBACK) -> list[dict]:
    """Compute projected points for every eligible player. Returns a list of
    dicts (at least id + projected_points, plus components for debugging)."""
    conn = get_db()
    c = conn.cursor()

    # Are we in-season yet? Controls whether bootstrap's cumulative fields are
    # this season's or last season's echo.
    c.execute("SELECT EXISTS(SELECT 1 FROM gameweeks WHERE finished = 1)")
    started = bool(c.fetchone()[0])

    # --- Players (single query, eligibility gate) --------------------------- #
    c.execute("""
        SELECT
            p.id, p.code, p.web_name, p.team_id, p.position, p.price,
            p.total_points, p.points_per_game, p.form, p.minutes, p.status,
            p.chance_of_playing_next_round, t.short_name AS team_name,
            COALESCE(p.xg_per90, 0.0), COALESCE(p.xa_per90, 0.0),
            COALESCE(p.seed_xg90, 0.0), COALESCE(p.seed_xa90, 0.0),
            COALESCE(p.seed_ppg, 0.0), COALESCE(p.last_season_minutes, 0),
            COALESCE(p.xg_source, '')
        FROM players p
        JOIN teams t ON p.team_id = t.id
        WHERE p.status != 'u'
          AND (p.minutes > 0
               OR COALESCE(p.last_season_minutes, 0) >= 300
               OR COALESCE(p.xg_source, '') <> '')
    """)
    cols = ["id", "code", "web_name", "team_id", "position", "price",
            "total_points", "points_per_game", "form", "minutes", "status",
            "chance_of_playing", "team_name", "xg_per90", "xa_per90",
            "seed_xg90", "seed_xa90", "seed_ppg", "last_season_minutes",
            "xg_source"]
    players = [dict(zip(cols, row)) for row in c.fetchall()]
    for p in players:
        for f in ["price", "points_per_game", "form", "xg_per90", "xa_per90",
                  "seed_xg90", "seed_xa90", "seed_ppg"]:
            p[f] = float(p[f] or 0)
        p["minutes"] = int(p["minutes"] or 0)
        p["last_season_minutes"] = int(p["last_season_minutes"] or 0)

    # --- Recent history for ALL players in ONE query ------------------------ #
    c.execute("""
        SELECT player_id, gameweek, total_points, minutes, bonus, bps
        FROM player_gameweek_history
        ORDER BY player_id, gameweek DESC
    """)
    history_by_player: dict[int, list] = {}
    for pid, gw, pts, mins, bonus, bps in c.fetchall():
        bucket = history_by_player.setdefault(pid, [])
        if len(bucket) < gw_lookback:
            bucket.append((float(pts or 0), float(mins or 0),
                           float(bonus or 0), float(bps or 0)))

    # --- Next-GW fixtures: FDR, opponent, venue ----------------------------- #
    c.execute("""
        SELECT f.team_h, f.team_a, f.team_h_difficulty, f.team_a_difficulty
        FROM fixtures f
        WHERE f.gameweek = (SELECT id FROM gameweeks WHERE is_next = 1 LIMIT 1)
    """)
    fdr_map, opponent_map, is_home_map = {}, {}, {}
    for team_h, team_a, fdh, fda in c.fetchall():
        fdr_map[team_h] = fdh
        fdr_map[team_a] = fda
        opponent_map[team_h] = team_a
        opponent_map[team_a] = team_h
        is_home_map[team_h] = True
        is_home_map[team_a] = False

    # --- Team clean-sheet rates + attack strength (bulk) -------------------- #
    def _cs_rates(is_home: bool) -> dict:
        if is_home:
            c.execute("""
                SELECT team_h, COUNT(*),
                       SUM(CASE WHEN team_a_score = 0 THEN 1 ELSE 0 END)
                FROM fixtures WHERE finished = 1 AND team_h_score IS NOT NULL
                GROUP BY team_h
            """)
        else:
            c.execute("""
                SELECT team_a, COUNT(*),
                       SUM(CASE WHEN team_h_score = 0 THEN 1 ELSE 0 END)
                FROM fixtures WHERE finished = 1 AND team_a_score IS NOT NULL
                GROUP BY team_a
            """)
        return {r[0]: (r[2] / r[1] if r[1] else 0.3) for r in c.fetchall()}

    def _attack_avg(is_home: bool) -> dict:
        if is_home:
            c.execute("""
                SELECT team_h, AVG(team_h_score) FROM fixtures
                WHERE finished = 1 AND team_h_score IS NOT NULL GROUP BY team_h
            """)
        else:
            c.execute("""
                SELECT team_a, AVG(team_a_score) FROM fixtures
                WHERE finished = 1 AND team_a_score IS NOT NULL GROUP BY team_a
            """)
        return {r[0]: float(r[1]) for r in c.fetchall() if r[1] is not None}

    cs_rate_home, cs_rate_away = _cs_rates(True), _cs_rates(False)
    atk_home, atk_away = _attack_avg(True), _attack_avg(False)
    conn.close()

    def _opp_attack_factor(opp_id: int, opp_is_home: bool) -> float:
        avg = (atk_home if opp_is_home else atk_away).get(opp_id, 1.3)
        return round(min(1.5, max(0.5, 0.5 + (avg / 1.3) * 0.5)), 3)

    fdr_multipliers = {1: 1.20, 2: 1.10, 3: 1.00, 4: 0.90, 5: 0.80}

    for p in players:
        pid, position, team_id = p["id"], p["position"], p["team_id"]
        history = history_by_player.get(pid, [])

        # Blend live current-season xG with the pre-season seed by real minutes.
        cur_min = p["minutes"] if started else 0
        w = min(1.0, cur_min / BLEND_FULL_MINUTES)
        eff_xg90 = w * p["xg_per90"] + (1 - w) * p["seed_xg90"]
        eff_xa90 = w * p["xa_per90"] + (1 - w) * p["seed_xa90"]
        sample_min = cur_min if started else p["last_season_minutes"]

        # Form decay from recent points; fall back to seed/ppg pre-season.
        if history:
            weights = [0.9 ** i for i in range(len(history))]
            decay_score = sum(h[0] * wt for h, wt in zip(history, weights)) / sum(weights)
            avg_minutes = sum(h[1] for h in history) / len(history)
            avg_bonus = sum(h[2] for h in history) / len(history)
            defcon_rate_def = sum(1 for h in history if h[3] >= BPS_DEFCON_THRESHOLD["DEF"]) / len(history)
            defcon_rate_mid = sum(1 for h in history if h[3] >= BPS_DEFCON_THRESHOLD["MID"]) / len(history)
            mins_factor = min(1.0, max(0.3, avg_minutes / 90.0))
        else:
            decay_score = p["seed_ppg"] if p["seed_ppg"] > 0 else (p["points_per_game"] or 2.0)
            avg_bonus = 0.0
            defcon_rate_def = defcon_rate_mid = 0.0
            mins_factor = _preseason_minutes_factor(sample_min)

        decay_score *= mins_factor

        # Underlying-stats blend.
        if position == "GKP":
            blended = decay_score
        else:
            xg_signal = _position_xg_signal(position, eff_xg90, eff_xa90)
            if xg_signal <= 0:
                blended = decay_score
            else:
                form_for_weight = p["form"] if started else 5.0
                max_w = _form_adaptive_xg_weight(form_for_weight, position)
                conf = min(1.0, max(0.0, (sample_min - 90) / 900.0))
                eff_w = max_w * conf
                blended = (1 - eff_w) * decay_score + eff_w * xg_signal

        # Clean-sheet contribution.
        is_home = is_home_map.get(team_id, True)
        opp_id = opponent_map.get(team_id)
        cs_pts = CS_PTS.get(position, 0)
        if cs_pts > 0 and opp_id is not None:
            base_cs = cs_rate_home.get(team_id, 0.3) if is_home else cs_rate_away.get(team_id, 0.3)
            adj_cs = base_cs / _opp_attack_factor(opp_id, not is_home)
            adj_cs = min(0.85, max(0.05, adj_cs))
            cs_bonus = adj_cs * cs_pts
        else:
            adj_cs, cs_bonus = 0.0, 0.0
        p["cs_probability"] = round(adj_cs if cs_pts > 0 else 0.0, 3)

        defcon_bonus = 0.0
        if position == "DEF":
            defcon_bonus = defcon_rate_def * DEFCON_PTS
        elif position == "MID":
            defcon_bonus = defcon_rate_mid * DEFCON_PTS

        projected = blended + cs_bonus + defcon_bonus + avg_bonus

        chance = p["chance_of_playing"]
        if chance is not None and chance < 100:
            projected *= (chance / 100.0)

        fdr = fdr_map.get(team_id, 3)
        projected *= fdr_multipliers.get(fdr, 1.0)

        p["projected_points"] = round(projected, 3)
        p["fdr"] = fdr
        p["_decay_score"] = round(decay_score, 3)
        p["_eff_xg90"] = round(eff_xg90, 3)
        p["_eff_xa90"] = round(eff_xa90, 3)
        p["_mins_factor"] = round(mins_factor, 3)

    return players


# --------------------------------------------------------------------------- #
# Fast read path (used by the API — reads precomputed projections)            #
# --------------------------------------------------------------------------- #

def get_players_for_optimization(db_path: str = None, gw_lookback: int = GW_LOOKBACK):
    """Fast single-query load of players with their stored projections, plus the
    next-GW FDR. Used by every optimizer endpoint and the team import."""
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        SELECT p.id, p.code, p.web_name, p.team_id, p.position, p.price,
               p.total_points, p.points_per_game, p.form, p.minutes, p.status,
               t.short_name AS team_name,
               COALESCE(p.xg_per90, 0.0), COALESCE(p.xa_per90, 0.0),
               COALESCE(p.xgi_per90, 0.0), p.projected_points
        FROM players p
        JOIN teams t ON p.team_id = t.id
        WHERE p.projected_points IS NOT NULL
    """)
    cols = ["id", "code", "web_name", "team_id", "position", "price",
            "total_points", "points_per_game", "form", "minutes", "status",
            "team_name", "xg_per90", "xa_per90", "xgi_per90", "projected_points"]
    players = [dict(zip(cols, row)) for row in c.fetchall()]

    c.execute("""
        SELECT f.team_h, f.team_a, f.team_h_difficulty, f.team_a_difficulty
        FROM fixtures f
        WHERE f.gameweek = (SELECT id FROM gameweeks WHERE is_next = 1 LIMIT 1)
    """)
    fdr_map = {}
    for team_h, team_a, fdh, fda in c.fetchall():
        fdr_map[team_h] = fdh
        fdr_map[team_a] = fda
    conn.close()

    for p in players:
        for f in ["price", "total_points", "points_per_game", "form", "minutes",
                  "xg_per90", "xa_per90", "xgi_per90", "projected_points"]:
            if p.get(f) is not None:
                p[f] = float(p[f])
        p["fdr"] = fdr_map.get(p["team_id"], 3)
    return players


# --------------------------------------------------------------------------- #
# Squad optimization + advice endpoints (unchanged logic, fast read path)     #
# --------------------------------------------------------------------------- #

def optimize_squad(budget: float = 100.0, db_path: str = None, bench_weight: float = 0.1):
    players = get_players_for_optimization()
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

    for team_id in set(p["team_id"] for p in players):
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
        "squad": squad, "total_cost": round(total_cost, 1),
        "budget_remaining": round(budget - total_cost, 1),
        "projected_points": round(total_projected, 1), "status": "optimal"
    }


def suggest_transfers(current_squad_ids: list, budget_itb: float, free_transfers: int = 1, db_path: str = None):
    players = get_players_for_optimization()
    player_map = {p["id"]: p for p in players}
    current_squad = [player_map[pid] for pid in current_squad_ids if pid in player_map]
    transfer_suggestions = []

    for sell_player in current_squad:
        available_budget = budget_itb + sell_player["price"]
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
                    "sell": {**sell_player},
                    "buy": {**buy_player},
                    "points_gain": round(gain, 2),
                    "cost_diff": round(buy_player["price"] - sell_player["price"], 1)
                })

    transfer_suggestions.sort(key=lambda x: -x["points_gain"])
    return transfer_suggestions[:10]


def suggest_captain(current_squad_ids: list, db_path: str = None):
    players = get_players_for_optimization()
    player_map = {p["id"]: p for p in players}

    conn = get_db()
    c = conn.cursor()
    c.execute("""
        SELECT team_h, team_a, team_h_difficulty, team_a_difficulty
        FROM fixtures
        WHERE gameweek = (SELECT id FROM gameweeks WHERE is_next = 1 LIMIT 1)
    """)
    next_fixtures = c.fetchall()
    c.execute("SELECT id, short_name FROM teams")
    team_names = {row[0]: row[1] for row in c.fetchall()}
    conn.close()

    fdr_map = {}
    fixture_map = {}
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
            **p, "fdr": fdr,
            "fixture": fixture_map.get(p["team_id"], "Unknown"),
            "fixture_multiplier": fixture_multiplier,
            "captain_score": round(adjusted_score, 2),
            "projected_captain_points": round(adjusted_score * 2, 2)
        })

    captain_options.sort(key=lambda x: -x["captain_score"])
    return captain_options


def analyze_hit_worthiness(current_squad_ids: list, budget_itb: float, free_transfers: int = 1, db_path: str = None):
    players = get_players_for_optimization()
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
                            "sell": sell_player, "buy": buy_player,
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
        "best_1_transfer": one_transfer, "best_2_transfers": two_transfers,
        "gain_1_transfer": round(gain_1, 2), "gain_2_transfers": round(gain_2, 2),
        "gain_2_after_hit": round(gain_2_after_hit, 2),
        "take_hit": gain_2_after_hit > gain_1 and free_transfers < 2,
        "recommendation": recommendation,
        "multi_week_plan": [
            {"week": "This week", "action": f"Make {min(free_transfers, len(one_transfer))} free transfer(s)" if gain_1 > 0 else "Hold", "transfers": one_transfer[:free_transfers]},
            {"week": "Next week", "action": "Bank the free transfer for a 2-transfer week" if gain_1 < 2 else "Use banked transfer on best available", "transfers": []}
        ]
    }


def analyze_chips(current_squad_ids: list, db_path: str = None):
    players = get_players_for_optimization()
    player_map = {p["id"]: p for p in players}

    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id FROM gameweeks WHERE is_next = 1 LIMIT 1")
    next_gw_row = c.fetchone()
    if not next_gw_row:
        conn.close()
        return {"error": "No upcoming gameweek found"}
    next_gw = next_gw_row[0]

    c.execute("""
        SELECT team_h, team_a, team_h_difficulty, team_a_difficulty, gameweek
        FROM fixtures
        WHERE gameweek BETWEEN %s AND %s
    """, (next_gw, next_gw + 4))
    fixtures = c.fetchall()
    conn.close()

    fdr_by_team = {}
    for team_h, team_a, fdh, fda, gw in fixtures:
        fdr_by_team.setdefault(team_h, []).append(fdh)
        fdr_by_team.setdefault(team_a, []).append(fda)

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
    squad_avg_fdrs_5gw = [sum(fdr_by_team.get(p["team_id"], [3, 3, 3, 3, 3])) / len(fdr_by_team.get(p["team_id"], [3, 3, 3, 3, 3])) for p in starting_11]
    avg_fdr_5gw = sum(squad_avg_fdrs_5gw) / len(squad_avg_fdrs_5gw) if squad_avg_fdrs_5gw else 3

    captain_options = suggest_captain(current_squad_ids)
    top_captain = captain_options[0] if captain_options else None
    tc_score = top_captain["captain_score"] if top_captain else 0
    tc_fdr = top_captain.get("fdr", 3) if top_captain else 3
    tc_recommended = tc_score >= 8 and tc_fdr <= 2

    tc_reason = (
        f"✅ {top_captain['web_name']} is your standout captain with a score of {round(tc_score,1)} and faces an {'easy' if tc_fdr <= 2 else 'medium'} fixture (FDR {tc_fdr}). Projected TC points: {round(tc_score * 3, 1)}."
        if tc_recommended else
        f"❌ No standout TC opportunity. Your best captain ({top_captain['web_name'] if top_captain else 'N/A'}) has a score of {round(tc_score,1)} — not exceptional enough to triple up."
    )

    bb_recommended = avg_bench_pts >= 4.5
    bb_reason = (
        f"✅ Your bench averages {round(avg_bench_pts,1)} projected pts — strong enough to boost. Bench players: {', '.join(p['web_name'] for p in bench)}."
        if bb_recommended else
        f"❌ Your bench averages only {round(avg_bench_pts,1)} projected pts. Not worth activating Bench Boost with this bench quality."
    )

    wc_recommended = avg_starting_pts < 5.0 and avg_fdr_5gw <= 2.8
    wc_reason = (
        f"✅ Your starting 11 averages {round(avg_starting_pts,1)} projected pts — below optimal. With a favorable 5-GW run ahead (avg FDR {round(avg_fdr_5gw,1)}), now is a good time to wildcard."
        if wc_recommended else
        f"❌ Wildcard not recommended. Starting 11 averages {round(avg_starting_pts,1)} pts and upcoming FDR is {round(avg_fdr_5gw,1)} — not compelling enough."
    )

    fh_recommended = avg_fdr_next >= 3.8
    fh_reason = (
        f"✅ Your squad faces a tough average FDR of {round(avg_fdr_next,1)} this gameweek. Free Hit lets you field a temporary squad optimized for this week only."
        if fh_recommended else
        f"❌ Free Hit not needed. Your squad's average FDR this week is {round(avg_fdr_next,1)} — manageable."
    )

    return {
        "squad_summary": {
            "avg_starting_pts": round(avg_starting_pts, 1), "avg_bench_pts": round(avg_bench_pts, 1),
            "avg_fdr_next_gw": round(avg_fdr_next, 1), "avg_fdr_5gw": round(avg_fdr_5gw, 1),
        },
        "chips": {
            "triple_captain": {"recommended": tc_recommended, "reason": tc_reason, "top_captain": top_captain["web_name"] if top_captain else None, "projected_points": round(tc_score * 3, 1) if top_captain else 0},
            "bench_boost": {"recommended": bb_recommended, "reason": bb_reason, "avg_bench_pts": round(avg_bench_pts, 1)},
            "wildcard": {"recommended": wc_recommended, "reason": wc_reason, "avg_starting_pts": round(avg_starting_pts, 1)},
            "free_hit": {"recommended": fh_recommended, "reason": fh_reason, "avg_fdr_next_gw": round(avg_fdr_next, 1)}
        }
    }
