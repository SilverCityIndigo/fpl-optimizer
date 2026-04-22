from fastapi import APIRouter
import psycopg2
import os
import requests
from services.optimizer import get_players_for_optimization

router = APIRouter()

def get_db():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    return conn

def rows_to_dicts(cursor):
    cols = [desc[0] for desc in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]

@router.get("/")
def get_players(position: str = None, team_id: int = None):
    conn = get_db()
    c = conn.cursor()
    query = """
        SELECT p.*, t.short_name as team_name
        FROM players p
        JOIN teams t ON p.team_id = t.id
        WHERE 1=1
    """
    params = []
    if position:
        query += " AND p.position = %s"
        params.append(position)
    if team_id:
        query += " AND p.team_id = %s"
        params.append(team_id)
    query += " ORDER BY p.total_points DESC"
    c.execute(query, params)
    players = rows_to_dicts(c)
    conn.close()
    return players

@router.get("/value")
def get_value_picks():
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        SELECT p.*, t.short_name as team_name,
               ROUND(p.total_points * 1.0 / p.price, 2) as value_score
        FROM players p
        JOIN teams t ON p.team_id = t.id
        WHERE p.minutes > 90 AND p.status = 'a'
        ORDER BY value_score DESC
        LIMIT 20
    """)
    players = rows_to_dicts(c)
    conn.close()
    return players

@router.get("/differentials")
def get_differentials():
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        SELECT p.id, p.code, p.web_name, p.position, p.price,
               p.total_points, p.points_per_game, p.form,
               p.selected_by_percent, p.status, p.minutes,
               t.short_name as team_name, t.id as team_id
        FROM players p
        JOIN teams t ON p.team_id = t.id
        WHERE p.status = 'a'
        AND p.form::float >= 4.0
        AND p.points_per_game::float >= 3.5
        AND p.selected_by_percent::float < 15.0
        AND p.minutes > 0
        ORDER BY p.form::float DESC
    """)
    players = rows_to_dicts(c)

    c.execute("""
        SELECT f.team_h, f.team_a, f.team_h_difficulty, f.team_a_difficulty,
               th.short_name as home_name, ta.short_name as away_name
        FROM fixtures f
        JOIN teams th ON f.team_h = th.id
        JOIN teams ta ON f.team_a = ta.id
        WHERE f.gameweek = (SELECT id FROM gameweeks WHERE is_next = 1 LIMIT 1)
    """)
    fixture_rows = c.fetchall()
    conn.close()

    fdr_map = {}
    fixture_map = {}
    for team_h, team_a, fdh, fda, home_name, away_name in fixture_rows:
        fdr_map[team_h] = fdh
        fdr_map[team_a] = fda
        fixture_map[team_h] = f"{home_name} vs {away_name}"
        fixture_map[team_a] = f"{home_name} vs {away_name}"

    fdr_labels = {1: 'Very Easy', 2: 'Easy', 3: 'Medium', 4: 'Hard', 5: 'Very Hard'}
    result = []
    for p in players:
        fdr = fdr_map.get(p["team_id"], 3)
        fixture = fixture_map.get(p["team_id"], "Unknown")
        fdr_label = fdr_labels.get(fdr, "Medium")
        form = float(p["form"])
        ppg = float(p["points_per_game"])
        ownership = float(p["selected_by_percent"])
        reasons = []
        if form >= 7:
            reasons.append(f"on fire with {form} form")
        elif form >= 5:
            reasons.append(f"in great form ({form})")
        else:
            reasons.append(f"decent form ({form})")
        if ppg >= 6:
            reasons.append(f"elite {ppg} PPG")
        elif ppg >= 5:
            reasons.append(f"strong {ppg} PPG")
        else:
            reasons.append(f"{ppg} PPG")
        if fdr <= 2:
            reasons.append(f"faces an easy fixture ({fixture})")
        elif fdr == 3:
            reasons.append(f"medium difficulty fixture ({fixture})")
        else:
            reasons.append(f"tough fixture ({fixture})")
        reasons.append(f"only {ownership}% owned")
        why = f"{reasons[0].capitalize()}, {reasons[1]}, {reasons[2]}, and {reasons[3]}."
        result.append({**p, "fdr": fdr, "fdr_label": fdr_label, "fixture": fixture, "why": why})
    return result

@router.get("/price-changes")
def get_price_changes():
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        SELECT p.id, p.code, p.web_name, p.position, p.price,
               p.total_points, p.points_per_game, p.form,
               p.selected_by_percent, p.status,
               p.transfers_in_event, p.transfers_out_event,
               t.short_name as team_name
        FROM players p
        JOIN teams t ON p.team_id = t.id
        WHERE p.minutes > 0
        AND (p.transfers_in_event > 0 OR p.transfers_out_event > 0)
    """)
    players = rows_to_dicts(c)
    conn.close()
    result = []
    for p in players:
        net = (p["transfers_in_event"] or 0) - (p["transfers_out_event"] or 0)
        total = (p["transfers_in_event"] or 0) + (p["transfers_out_event"] or 0)
        if total == 0:
            continue
        pressure = round(net / total * 100, 1)
        transfers_in = p["transfers_in_event"] or 0
        transfers_out = p["transfers_out_event"] or 0
        ownership = float(p["selected_by_percent"] or 0)
        if not (transfers_in >= 5000 or (transfers_out >= 5000 and ownership >= 1.0)):
            continue
        trend = "rising" if pressure >= 50 else "falling" if pressure <= -50 else "stable"
        result.append({**p, "net_transfers": net, "pressure_score": pressure, "trend": trend})
    result.sort(key=lambda x: -x["pressure_score"])
    return result

@router.get("/{player_id}/history")
def get_player_history(player_id: int):
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        SELECT * FROM player_gameweek_history
        WHERE player_id = %s
        ORDER BY gameweek ASC
    """, (player_id,))
    history = rows_to_dicts(c)
    conn.close()
    return history

@router.get("/team/{team_id}")
def get_team_squad(team_id: int):
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT id FROM gameweeks WHERE is_current = 1 LIMIT 1")
        row = c.fetchone()
        conn.close()
        current_gw = row[0] if row else 29

        r = requests.get(
            f"https://fantasy.premierleague.com/api/entry/{team_id}/event/{current_gw}/picks/",
            headers={"User-Agent": "Mozilla/5.0"}, timeout=10
        )
        if r.status_code != 200:
            return {"error": f"Could not fetch team (status {r.status_code}). Check your team ID."}

        data = r.json()
        raw_picks = data["picks"]
        player_ids = [p["element"] for p in raw_picks]
        picks = [{"element": p["element"], "position": p["position"], "is_sub": p["position"] > 11} for p in raw_picks]
        bank = round(data.get("entry_history", {}).get("bank", 0) / 10, 1)
        transfers_made = data.get("entry_history", {}).get("event_transfers", 0)
        transfers_left = max(1, 2 - transfers_made)

        history_r = requests.get(
            f"https://fantasy.premierleague.com/api/entry/{team_id}/history/",
            headers={"User-Agent": "Mozilla/5.0"}, timeout=10
        )
        chips_available = {"wildcard": True, "freehit": True, "bboost": True, "3xc": True}
        if history_r.status_code == 200:
            chips_used = history_r.json().get("chips", [])
            counts = {"wildcard": 0, "freehit": 0, "bboost": 0, "3xc": 0}
            for chip in chips_used:
                name = chip.get("name", "")
                if name in counts:
                    counts[name] += 1
            for k, v in counts.items():
                if v >= 2:
                    chips_available[k] = False

        all_players = get_players_for_optimization(os.environ["DATABASE_URL"])
        proj_map = {p["id"]: p for p in all_players}

        conn2 = get_db()
        c2 = conn2.cursor()
        c2.execute("""
            SELECT f.team_h, f.team_a,
                   th.short_name as home_name, ta.short_name as away_name
            FROM fixtures f
            JOIN teams th ON f.team_h = th.id
            JOIN teams ta ON f.team_a = ta.id
            WHERE f.gameweek = (SELECT id FROM gameweeks WHERE is_next = 1 LIMIT 1)
        """)
        fixture_rows = c2.fetchall()
        conn2.close()
        next_fixture_map = {}
        for team_h, team_a, home_name, away_name in fixture_rows:
            next_fixture_map[team_h] = f"{away_name} (H)"
            next_fixture_map[team_a] = f"{home_name} (A)"

        conn = get_db()
        c = conn.cursor()
        placeholders = ",".join(["%s"] * len(player_ids))
        c.execute(f"""
            SELECT p.id, p.code, p.web_name, p.position, p.price, p.total_points,
                   p.form, p.points_per_game, p.status, p.team_id,
                   t.short_name as team_name
            FROM players p
            JOIN teams t ON p.team_id = t.id
            WHERE p.id IN ({placeholders})
        """, player_ids)
        players = rows_to_dicts(c)
        conn.close()

        for p in players:
            proj = proj_map.get(p["id"])
            p["projected_points"] = round(proj["projected_points"], 1) if proj else None
            p["next_fixture"] = next_fixture_map.get(p["team_id"], "TBD")

        return {
            "players": players, "player_ids": player_ids, "picks": picks,
            "bank": bank, "transfers_left": transfers_left,
            "chips_available": chips_available, "next_gw": current_gw + 1,
        }
    except Exception as e:
        return {"error": str(e)}