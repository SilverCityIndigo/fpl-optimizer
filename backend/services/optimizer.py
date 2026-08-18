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

# How many gameweeks ahead the transfer/hit maths looks. A transfer is a
# multi-week commitment, so ranking it on one fixture is mostly noise.
HORIZON_GWS = 5

# Fixture difficulty is applied ONCE, here, to the attacking part of a
# projection. Clean sheets get their own opponent adjustment further down, so
# multiplying them by this as well would double-count the same fixture.
FDR_MULTIPLIERS = {1: 1.20, 2: 1.10, 3: 1.00, 4: 0.90, 5: 0.80}

# Formation legality for "best available XI" (1 GKP is implicit).
FORMATION_MIN = {"DEF": 3, "MID": 2, "FWD": 1}
FORMATION_MAX = {"DEF": 5, "MID": 5, "FWD": 3}


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

    # --- Fixtures across the horizon ---------------------------------------- #
    # Keyed team -> gameweek -> [(fdr, is_home, opponent_id), ...]. A list per
    # gameweek because a team can have two fixtures (double) or none (blank);
    # the old single-value map silently dropped one half of a double and
    # projected blanks as if the team were playing.
    c.execute("SELECT id FROM gameweeks WHERE is_next = 1 LIMIT 1")
    row = c.fetchone()
    next_gw = row[0] if row else None

    fixtures_by_team: dict[int, dict[int, list]] = {}
    horizon_gws: list[int] = []
    if next_gw is not None:
        horizon_gws = list(range(next_gw, next_gw + HORIZON_GWS))
        c.execute("""
            SELECT f.gameweek, f.team_h, f.team_a,
                   f.team_h_difficulty, f.team_a_difficulty
            FROM fixtures f
            WHERE f.gameweek >= %s AND f.gameweek < %s
        """, (next_gw, next_gw + HORIZON_GWS))
        for gw, team_h, team_a, fdh, fda in c.fetchall():
            fixtures_by_team.setdefault(team_h, {}).setdefault(gw, []).append(
                (fdh or 3, True, team_a))
            fixtures_by_team.setdefault(team_a, {}).setdefault(gw, []).append(
                (fda or 3, False, team_h))

    # Safety valve: if NO team has a fixture for the next gameweek the fixture
    # table simply has not been populated yet. Treat everyone as playing one
    # average match rather than projecting the entire league to zero.
    next_gw_loaded = any(
        next_gw in by_gw and by_gw[next_gw] for by_gw in fixtures_by_team.values()
    )

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

    def _clean_sheet_prob(team_id: int, is_home: bool, opp_id: int) -> float:
        base = (cs_rate_home if is_home else cs_rate_away).get(team_id, 0.3)
        adj = base / _opp_attack_factor(opp_id, not is_home)
        return min(0.85, max(0.05, adj))

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

        defcon_bonus = 0.0
        if position == "DEF":
            defcon_bonus = defcon_rate_def * DEFCON_PTS
        elif position == "MID":
            defcon_bonus = defcon_rate_mid * DEFCON_PTS

        # Everything above is fixture-independent: a per-match scoring rate.
        base_rate = blended + defcon_bonus + avg_bonus
        chance = p["chance_of_playing"]
        if chance is not None and chance < 100:
            base_rate *= (chance / 100.0)

        cs_pts = CS_PTS.get(position, 0)
        by_gw = fixtures_by_team.get(team_id, {})

        def _match_points(fixture) -> tuple[float, float]:
            """Points for one fixture, plus its clean-sheet probability. FDR
            scales the attacking rate; the clean sheet is scaled by the
            opponent's attack instead, so no fixture is counted twice."""
            fdr, is_home, opp_id = fixture
            attack = base_rate * FDR_MULTIPLIERS.get(fdr, 1.0)
            if cs_pts > 0 and opp_id is not None:
                cs_prob = _clean_sheet_prob(team_id, is_home, opp_id)
                return attack + cs_prob * cs_pts, cs_prob
            return attack, 0.0

        next_fixtures = by_gw.get(next_gw, []) if next_gw is not None else []
        if not next_fixtures and not next_gw_loaded:
            # Fixture data missing entirely — assume one neutral home match.
            next_fixtures = [(3, True, None)]

        # Sum, not average: a blank gameweek scores nothing and a double counts
        # both matches.
        next_results = [_match_points(f) for f in next_fixtures]
        projected = sum(pts for pts, _ in next_results)
        cs_prob_display = max((cs for _, cs in next_results), default=0.0)

        # Multi-week rate for transfer decisions, expressed as points per
        # gameweek so it stays comparable to the single-gameweek projection.
        horizon_total = 0.0
        for gw in horizon_gws:
            fixtures = by_gw.get(gw, [])
            if not fixtures and not next_gw_loaded:
                fixtures = [(3, True, None)]
            horizon_total += sum(pts for pts, _ in (_match_points(f) for f in fixtures))
        horizon_per_gw = horizon_total / len(horizon_gws) if horizon_gws else projected

        fdr = next_fixtures[0][0] if next_fixtures else 3

        p["projected_points"] = round(projected, 3)
        p["projected_horizon"] = round(horizon_per_gw, 3)
        p["cs_probability"] = round(cs_prob_display if cs_pts > 0 else 0.0, 3)
        p["fdr"] = fdr
        p["next_gw_fixtures"] = len(next_fixtures)
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
               COALESCE(p.xgi_per90, 0.0), p.projected_points,
               COALESCE(p.projected_horizon, p.projected_points)
        FROM players p
        JOIN teams t ON p.team_id = t.id
        WHERE p.projected_points IS NOT NULL
    """)
    cols = ["id", "code", "web_name", "team_id", "position", "price",
            "total_points", "points_per_game", "form", "minutes", "status",
            "team_name", "xg_per90", "xa_per90", "xgi_per90", "projected_points",
            "projected_horizon"]
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
                  "xg_per90", "xa_per90", "xgi_per90", "projected_points",
                  "projected_horizon"]:
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


def _team_counts(squad_ids: list, player_map: dict) -> dict:
    counts: dict[int, int] = {}
    for pid in squad_ids:
        p = player_map.get(pid)
        if p:
            counts[p["team_id"]] = counts.get(p["team_id"], 0) + 1
    return counts


def _buy_candidates(sell_player, players, squad_ids, player_map, budget_itb,
                    exclude_ids=frozenset()):
    """Legal replacements for one player: same position, affordable, available,
    and not breaking the three-per-club rule."""
    counts = _team_counts(squad_ids, player_map)
    # Selling frees a slot at the outgoing player's club.
    counts[sell_player["team_id"]] = counts.get(sell_player["team_id"], 1) - 1
    available_budget = budget_itb + sell_player["price"]
    return [
        p for p in players
        if p["position"] == sell_player["position"]
        and p["id"] not in squad_ids
        and p["id"] not in exclude_ids
        and p["price"] <= available_budget
        # 'a' available, 'd' doubtful (already discounted in the projection).
        and p["status"] in ("a", "d")
        and counts.get(p["team_id"], 0) < 3
    ]


def _gain(buy_player, sell_player) -> float:
    """Expected points per gameweek gained, over the whole horizon rather than
    the next fixture alone. A transfer is a multi-week commitment, so judging it
    on one fixture just chases whoever happens to have an easy game."""
    return buy_player["projected_horizon"] - sell_player["projected_horizon"]


def suggest_transfers(current_squad_ids: list, budget_itb: float, free_transfers: int = 1, db_path: str = None):
    players = get_players_for_optimization()
    player_map = {p["id"]: p for p in players}
    current_squad = [player_map[pid] for pid in current_squad_ids if pid in player_map]
    transfer_suggestions = []

    for sell_player in current_squad:
        candidates = _buy_candidates(
            sell_player, players, current_squad_ids, player_map, budget_itb)
        for buy_player in sorted(candidates, key=lambda x: -x["projected_horizon"])[:5]:
            gain = _gain(buy_player, sell_player)
            if gain > 0:
                transfer_suggestions.append({
                    "sell": {**sell_player},
                    "buy": {**buy_player},
                    "points_gain": round(gain, 2),
                    "gain_over_horizon": round(gain * HORIZON_GWS, 2),
                    "cost_diff": round(buy_player["price"] - sell_player["price"], 1)
                })

    transfer_suggestions.sort(key=lambda x: -x["points_gain"])

    # One suggestion per outgoing player and per incoming player, otherwise the
    # list is the same premium striker repeated against six different sells.
    seen_sell, seen_buy, deduped = set(), set(), []
    for s in transfer_suggestions:
        if s["sell"]["id"] in seen_sell or s["buy"]["id"] in seen_buy:
            continue
        seen_sell.add(s["sell"]["id"])
        seen_buy.add(s["buy"]["id"])
        deduped.append(s)
    return deduped[:10]


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
        # projected_points is ALREADY fixture-adjusted by compute_projections.
        # This used to multiply by a second, steeper FDR curve, so an easy
        # fixture was rewarded 1.20 x 1.30 = 1.56x and a hard one punished
        # 0.80 x 0.70 = 0.56x — a 2.8x spread that buried player quality under
        # fixture difficulty. The armband should go to the highest expected
        # score, which is the projection itself.
        captain_score = p["projected_points"]
        captain_options.append({
            **p, "fdr": fdr,
            "fixture": fixture_map.get(p["team_id"], "Unknown"),
            "captain_score": round(captain_score, 2),
            "projected_captain_points": round(captain_score * 2, 2)
        })

    # Unavailable players can't wear the armband.
    captain_options = [c for c in captain_options if c.get("status") != "u"]
    captain_options.sort(key=lambda x: -x["captain_score"])
    return captain_options


def analyze_hit_worthiness(current_squad_ids: list, budget_itb: float, free_transfers: int = 1, db_path: str = None):
    players = get_players_for_optimization()
    player_map = {p["id"]: p for p in players}

    def get_best_transfers(n):
        """Greedily pick n transfers, keeping the squad legal as we go."""
        suggestions = []
        temp_squad_ids = list(current_squad_ids)
        temp_budget = budget_itb
        bought_ids = set()

        for _ in range(n):
            best = None
            for sell_player in [player_map[pid] for pid in temp_squad_ids if pid in player_map]:
                candidates = _buy_candidates(
                    sell_player, players, temp_squad_ids, player_map, temp_budget,
                    exclude_ids=bought_ids)
                for buy_player in sorted(candidates, key=lambda x: -x["projected_horizon"])[:5]:
                    gain = _gain(buy_player, sell_player)
                    if gain > 0 and (best is None or gain > best["points_gain"]):
                        best = {
                            "sell": sell_player, "buy": buy_player,
                            "points_gain": round(gain, 2),
                            "gain_over_horizon": round(gain * HORIZON_GWS, 2),
                            "cost_diff": round(buy_player["price"] - sell_player["price"], 1)
                        }
            if not best:
                break
            suggestions.append(best)
            bought_ids.add(best["buy"]["id"])
            temp_squad_ids = [best["buy"]["id"] if pid == best["sell"]["id"] else pid
                              for pid in temp_squad_ids]
            temp_budget -= best["cost_diff"]

        return suggestions

    one_transfer = get_best_transfers(1)
    two_transfers = get_best_transfers(2)

    # Gains are points per gameweek; the hit is a one-off 4. Comparing a single
    # gameweek's gain against the full 4 made hits look almost never worth it,
    # which is wrong: you keep the better player for the whole horizon. Totalling
    # both sides over the horizon is the honest comparison.
    gain_1 = sum(t["points_gain"] for t in one_transfer) * HORIZON_GWS
    gain_2 = sum(t["points_gain"] for t in two_transfers) * HORIZON_GWS
    gain_2_after_hit = gain_2 - 4
    take_hit = free_transfers < 2 and gain_2_after_hit > gain_1 and gain_2_after_hit > 0

    if free_transfers >= 2:
        recommendation = (
            f"You have {free_transfers} free transfers — make both without penalty. "
            f"Expected gain {round(gain_2, 1)} pts over the next {HORIZON_GWS} gameweeks."
        )
    elif take_hit:
        recommendation = (
            f"✅ Take the hit. Two transfers gain {round(gain_2, 1)} pts over {HORIZON_GWS} "
            f"gameweeks, minus 4 for the hit = {round(gain_2_after_hit, 1)} net, versus "
            f"{round(gain_1, 1)} for one free move."
        )
    elif gain_1 > 0:
        recommendation = (
            f"❌ Don't take the hit. One free transfer gains {round(gain_1, 1)} pts over "
            f"{HORIZON_GWS} gameweeks; the second move plus the −4 nets "
            f"{round(gain_2_after_hit, 1)}, which is worse."
        )
    else:
        recommendation = "No beneficial transfers found. Hold and bank the transfer."

    return {
        "free_transfers": free_transfers,
        "horizon_gws": HORIZON_GWS,
        "best_1_transfer": one_transfer, "best_2_transfers": two_transfers,
        "gain_1_transfer": round(gain_1, 2), "gain_2_transfers": round(gain_2, 2),
        "gain_2_after_hit": round(gain_2_after_hit, 2),
        "take_hit": take_hit,
        "recommendation": recommendation,
        "multi_week_plan": [
            {"week": "This week", "action": f"Make {min(free_transfers, len(one_transfer))} free transfer(s)" if gain_1 > 0 else "Hold", "transfers": one_transfer[:free_transfers]},
            {"week": "Next week", "action": "Bank the free transfer for a 2-transfer week" if gain_1 < 2 else "Use banked transfer on best available", "transfers": []}
        ]
    }


def _best_legal_eleven(squad: list) -> tuple[list, list]:
    """Highest-projecting XI that FPL would actually let you field: one keeper,
    3-5 DEF, 2-5 MID, 1-3 FWD. Taking the top 10 outfielders by projection (the
    previous approach) can return illegal shapes like two defenders, which
    inflates the starting XI and understates the bench."""
    by_pos = {
        pos: sorted([p for p in squad if p["position"] == pos],
                    key=lambda x: -x["projected_points"])
        for pos in ("GKP", "DEF", "MID", "FWD")
    }
    if not by_pos["GKP"]:
        ordered = sorted(squad, key=lambda x: -x["projected_points"])
        return ordered[:11], ordered[11:]

    starters = [by_pos["GKP"][0]]
    # Start from the minimum legal shape, then fill the remaining slots with
    # whoever projects highest and still fits under the per-position cap.
    for pos, minimum in FORMATION_MIN.items():
        starters.extend(by_pos[pos][:minimum])

    used = {p["id"] for p in starters}
    counts = {pos: min(len(by_pos[pos]), FORMATION_MIN[pos]) for pos in FORMATION_MIN}
    remaining = sorted(
        [p for p in squad if p["id"] not in used and p["position"] != "GKP"],
        key=lambda x: -x["projected_points"],
    )
    for p in remaining:
        if len(starters) >= 11:
            break
        pos = p["position"]
        if counts.get(pos, 0) < FORMATION_MAX.get(pos, 5):
            starters.append(p)
            counts[pos] = counts.get(pos, 0) + 1

    starter_ids = {p["id"] for p in starters}
    bench = [p for p in squad if p["id"] not in starter_ids]
    return starters, bench


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

    starting_11, bench = _best_legal_eleven(squad)

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
    # Triple Captain buys you ONE extra copy of the captain's score, so the bar
    # is "is that extra copy worth a chip". Recalibrated because captain_score no
    # longer carries the doubled fixture multiplier it used to.
    tc_recommended = tc_score >= 7.0 and tc_fdr <= 3
    tc_reason = (
        f"✅ {top_captain['web_name']} projects {round(tc_score,1)} pts against an "
        f"{'easy' if tc_fdr <= 2 else 'even'} fixture (FDR {tc_fdr}). Tripling adds roughly "
        f"{round(tc_score,1)} pts over a normal captain — projected TC total {round(tc_score * 3, 1)}."
        if tc_recommended else
        f"❌ No standout TC opportunity. Your best captain "
        f"({top_captain['web_name'] if top_captain else 'N/A'}) projects {round(tc_score,1)} pts, "
        f"so the extra copy is worth about the same — not enough to burn the chip."
    )

    bench_total = sum(p["projected_points"] for p in bench)
    bb_recommended = avg_bench_pts >= 4.0
    bb_reason = (
        f"✅ Your bench projects {round(bench_total,1)} pts total "
        f"({round(avg_bench_pts,1)} each) — worth boosting. Bench: "
        f"{', '.join(p['web_name'] for p in bench)}."
        if bb_recommended else
        f"❌ Your bench projects only {round(bench_total,1)} pts total "
        f"({round(avg_bench_pts,1)} each). Hold the chip for a stronger bench or a double gameweek."
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
