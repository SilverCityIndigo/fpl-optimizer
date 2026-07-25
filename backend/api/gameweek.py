from fastapi import APIRouter
import psycopg2
import os

router = APIRouter()

def get_db():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    return conn

@router.get("/current")
def get_current_gameweek():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM gameweeks WHERE is_current = 1 LIMIT 1")
    row = c.fetchone()
    preseason = False
    if not row:
        # Before the season starts there is no current GW — show the upcoming one.
        c.execute("SELECT * FROM gameweeks WHERE is_next = 1 LIMIT 1")
        row = c.fetchone()
        preseason = True
    if not row:
        conn.close()
        return {"error": "No gameweek data found. Run a data sync."}
    cols = [desc[0] for desc in c.description] if c.description else []
    conn.close()
    result = dict(zip(cols, row))
    result["preseason"] = preseason
    return result

@router.get("/fdr-table")
def get_fdr_table(next_gws: int = 5):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id FROM gameweeks WHERE is_next = 1 LIMIT 1")
    row = c.fetchone()
    if not row:
        conn.close()
        return {"error": "No upcoming gameweek found"}
    start_gw = row[0]
    end_gw = start_gw + next_gws - 1
    c.execute("""
        SELECT t.id, t.short_name, f.gameweek,
               CASE WHEN f.team_h = t.id THEN f.team_h_difficulty
                    ELSE f.team_a_difficulty END as difficulty,
               CASE WHEN f.team_h = t.id THEN 'H' ELSE 'A' END as venue
        FROM teams t
        JOIN fixtures f ON (f.team_h = t.id OR f.team_a = t.id)
        WHERE f.gameweek BETWEEN %s AND %s
        ORDER BY t.short_name, f.gameweek
    """, (start_gw, end_gw))
    cols = [desc[0] for desc in c.description]
    rows = [dict(zip(cols, row)) for row in c.fetchall()]
    conn.close()
    return rows