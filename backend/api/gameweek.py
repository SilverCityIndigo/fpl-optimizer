from fastapi import APIRouter
import sqlite3

router = APIRouter()
DB_PATH = "fpl.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@router.get("/current")
def get_current_gameweek():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM gameweeks WHERE is_current = 1 LIMIT 1")
    gw = c.fetchone()
    conn.close()
    return dict(gw) if gw else {"error": "No current gameweek found"}

@router.get("/fdr-table")
def get_fdr_table(next_gws: int = 5):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT id FROM gameweeks WHERE is_next = 1 LIMIT 1")
    next_gw = c.fetchone()
    if not next_gw:
        return {"error": "No upcoming gameweek found"}
    
    start_gw = next_gw["id"]
    end_gw = start_gw + next_gws - 1

    c.execute("""
        SELECT t.id, t.short_name, f.gameweek,
               CASE WHEN f.team_h = t.id THEN f.team_h_difficulty
                    ELSE f.team_a_difficulty END as difficulty,
               CASE WHEN f.team_h = t.id THEN 'H' ELSE 'A' END as venue
        FROM teams t
        JOIN fixtures f ON (f.team_h = t.id OR f.team_a = t.id)
        WHERE f.gameweek BETWEEN ? AND ?
        ORDER BY t.short_name, f.gameweek
    """, (start_gw, end_gw))
    
    rows = [dict(row) for row in c.fetchall()]
    conn.close()
    return rows