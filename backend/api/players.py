from fastapi import APIRouter
import sqlite3
import requests

router = APIRouter()
DB_PATH = "fpl.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

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
        query += " AND p.position = ?"
        params.append(position)
    if team_id:
        query += " AND p.team_id = ?"
        params.append(team_id)
    query += " ORDER BY p.total_points DESC"
    c.execute(query, params)
    players = [dict(row) for row in c.fetchall()]
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
    players = [dict(row) for row in c.fetchall()]
    conn.close()
    return players

@router.get("/differentials")
def get_differentials():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""
        SELECT p.id, p.code, p.web_name, p.position, p.price,
               p.total_points, p.points_per_game, p.form,
               p.selected_by_percent, p.status, p.minutes,
               t.short_name as team_name, t.id as team_id
        FROM players p
        JOIN teams t ON p.team_id = t.id
        WHERE p.status = 'a'
        AND CAST(p.form AS FLOAT) >= 4.0
        AND CAST(p.points_per_game AS FLOAT) >= 3.5
        AND CAST(p.selected_by_percent AS FLOAT) < 15.0
        AND p.minutes > 0
        ORDER BY CAST(p.form AS FLOAT) DESC
    """)

    columns = ["id", "code", "web_name", "position", "price",
               "total_points", "points_per_game", "form",
               "selected_by_percent", "status", "minutes",
               "team_name", "team_id"]

    players = [dict(zip(columns, row)) for row in c.fetchall()]

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

        result.append({
            **p,
            "fdr": fdr,
            "fdr_label": fdr_label,
            "fixture": fixture,
            "why": why
        })

    return result

@router.get("/{player_id}/history")
def get_player_history(player_id: int):
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        SELECT * FROM player_gameweek_history
        WHERE player_id = ?
        ORDER BY gameweek ASC
    """, (player_id,))
    history = [dict(row) for row in c.fetchall()]
    conn.close()
    return history

@router.get("/team/{team_id}")
def get_team_squad(team_id: int):
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT id FROM gameweeks WHERE is_current = 1 LIMIT 1")
        gw = c.fetchone()
        conn.close()

        current_gw = gw["id"] if gw else 29

        r = requests.get(
            f"https://fantasy.premierleague.com/api/entry/{team_id}/event/{current_gw}/picks/",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10
        )
        if r.status_code != 200:
            return {"error": f"Could not fetch team (status {r.status_code}). Check your team ID."}

        picks = r.json()["picks"]
        player_ids = [p["element"] for p in picks]

        conn = get_db()
        c = conn.cursor()
        placeholders = ",".join("?" * len(player_ids))
        c.execute(f"""
            SELECT p.id, p.code, p.web_name, p.position, p.price, p.total_points,
                   p.form, p.points_per_game, p.status, t.short_name as team_name
            FROM players p
            JOIN teams t ON p.team_id = t.id
            WHERE p.id IN ({placeholders})
        """, player_ids)
        players = [dict(row) for row in c.fetchall()]
        conn.close()
        return {"players": players, "player_ids": player_ids}
    except Exception as e:
        return {"error": str(e)}


@router.get("/price-changes")
def get_price_changes():
    conn = sqlite3.connect(DB_PATH)
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

    columns = ["id", "code", "web_name", "position", "price",
               "total_points", "points_per_game", "form",
               "selected_by_percent", "status",
               "transfers_in_event", "transfers_out_event", "team_name"]

    players = [dict(zip(columns, row)) for row in c.fetchall()]
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

        # Filter for relevance: meaningful transfer volume + ownership
        is_rising_relevant = transfers_in >= 5000
        is_falling_relevant = transfers_out >= 5000 and ownership >= 1.0

        if not (is_rising_relevant or is_falling_relevant):
            continue

        if pressure >= 50:
            trend = "rising"
        elif pressure <= -50:
            trend = "falling"
        else:
            trend = "stable"

        result.append({
            **p,
            "net_transfers": net,
            "pressure_score": pressure,
            "trend": trend
        })

    result.sort(key=lambda x: -x["pressure_score"])
    return result