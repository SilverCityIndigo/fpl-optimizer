"""
FPL Data Fetcher
Pulls data from the official Fantasy Premier League API.
Endpoints used:
  - /bootstrap-static/  → all players, teams, gameweeks
  - /element-summary/{id}/ → per-player gameweek history
  - /fixtures/ → full fixture list with FDR

xG data sourced from Understat.com via understatapi package.
Season key for 2025/26 = "2025" (Understat uses the start year).
"""

import requests
import sqlite3
import asyncio
from datetime import datetime
from rapidfuzz import process, fuzz
from understatapi import UnderstatClient

BASE_URL = "https://fantasy.premierleague.com/api"
UNDERSTAT_SEASON = "2025"  # 2025/26 season → Understat key is "2025"

HEADERS = {
    "User-Agent": "Mozilla/5.0"
}


def get_bootstrap():
    r = requests.get(f"{BASE_URL}/bootstrap-static/", headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def get_fixtures():
    r = requests.get(f"{BASE_URL}/fixtures/", headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def get_player_history(player_id: int):
    r = requests.get(f"{BASE_URL}/element-summary/{player_id}/", headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def init_db(db_path: str = "fpl.db"):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    c.executescript("""
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY,
            name TEXT,
            short_name TEXT,
            strength INTEGER,
            strength_attack_home INTEGER,
            strength_attack_away INTEGER,
            strength_defence_home INTEGER,
            strength_defence_away INTEGER
        );

        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY,
            code INTEGER,
            web_name TEXT,
            full_name TEXT,
            team_id INTEGER,
            position TEXT,
            price REAL,
            total_points INTEGER,
            points_per_game REAL,
            form REAL,
            selected_by_percent REAL,
            minutes INTEGER,
            goals_scored INTEGER,
            assists INTEGER,
            clean_sheets INTEGER,
            bonus INTEGER,
            ict_index REAL,
            news TEXT,
            chance_of_playing_next_round INTEGER,
            status TEXT,
            transfers_in_event INTEGER,
            transfers_out_event INTEGER,
            xg_per90 REAL DEFAULT 0.0,
            xa_per90 REAL DEFAULT 0.0,
            xgi_per90 REAL DEFAULT 0.0,
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS gameweeks (
            id INTEGER PRIMARY KEY,
            name TEXT,
            deadline_time TEXT,
            finished INTEGER,
            is_current INTEGER,
            is_next INTEGER,
            average_entry_score INTEGER,
            highest_score INTEGER
        );

        CREATE TABLE IF NOT EXISTS player_gameweek_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER,
            gameweek INTEGER,
            total_points INTEGER,
            minutes INTEGER,
            goals_scored INTEGER,
            assists INTEGER,
            clean_sheets INTEGER,
            bonus INTEGER,
            bps INTEGER,
            ict_index REAL,
            value REAL,
            selected INTEGER,
            transfers_in INTEGER,
            transfers_out INTEGER,
            expected_goals REAL,
            expected_assists REAL,
            expected_goal_involvements REAL,
            UNIQUE(player_id, gameweek)
        );

        CREATE TABLE IF NOT EXISTS fixtures (
            id INTEGER PRIMARY KEY,
            gameweek INTEGER,
            team_h INTEGER,
            team_a INTEGER,
            team_h_difficulty INTEGER,
            team_a_difficulty INTEGER,
            team_h_score INTEGER,
            team_a_score INTEGER,
            finished INTEGER,
            kickoff_time TEXT
        );
    """)

    # Safely add columns to existing DBs that predate this schema
    for col, typ in [
        ("xg_per90", "REAL DEFAULT 0.0"),
        ("xa_per90", "REAL DEFAULT 0.0"),
        ("xgi_per90", "REAL DEFAULT 0.0"),
    ]:
        try:
            c.execute(f"ALTER TABLE players ADD COLUMN {col} {typ}")
        except Exception:
            pass

    # Add per-GW xG columns to history table if they don't exist yet
    for col, typ in [
        ("expected_goals", "REAL"),
        ("expected_assists", "REAL"),
        ("expected_goal_involvements", "REAL"),
    ]:
        try:
            c.execute(f"ALTER TABLE player_gameweek_history ADD COLUMN {col} {typ}")
            print(f"✅ Added column {col} to player_gameweek_history")
        except Exception:
            pass  # already exists

    conn.commit()
    conn.close()
    print("✅ Database schema ready.")


POSITION_MAP = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}


def sync_bootstrap(db_path: str = "fpl.db"):
    print("📡 Fetching bootstrap data...")
    data = get_bootstrap()
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    now = datetime.utcnow().isoformat()

    for t in data["teams"]:
        c.execute("""
            INSERT OR REPLACE INTO teams VALUES (?,?,?,?,?,?,?,?)
        """, (t["id"], t["name"], t["short_name"], t["strength"],
              t["strength_attack_home"], t["strength_attack_away"],
              t["strength_defence_home"], t["strength_defence_away"]))

    for p in data["elements"]:
        c.execute("""
            INSERT INTO players (
                id, code, web_name, full_name, team_id, position, price,
                total_points, points_per_game, form, selected_by_percent,
                minutes, goals_scored, assists, clean_sheets, bonus,
                ict_index, news, chance_of_playing_next_round, status,
                transfers_in_event, transfers_out_event,
                xg_per90, xa_per90, xgi_per90, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0.0,0.0,0.0,?)
            ON CONFLICT(id) DO UPDATE SET
                code=excluded.code,
                web_name=excluded.web_name,
                full_name=excluded.full_name,
                team_id=excluded.team_id,
                position=excluded.position,
                price=excluded.price,
                total_points=excluded.total_points,
                points_per_game=excluded.points_per_game,
                form=excluded.form,
                selected_by_percent=excluded.selected_by_percent,
                minutes=excluded.minutes,
                goals_scored=excluded.goals_scored,
                assists=excluded.assists,
                clean_sheets=excluded.clean_sheets,
                bonus=excluded.bonus,
                ict_index=excluded.ict_index,
                news=excluded.news,
                chance_of_playing_next_round=excluded.chance_of_playing_next_round,
                status=excluded.status,
                transfers_in_event=excluded.transfers_in_event,
                transfers_out_event=excluded.transfers_out_event,
                updated_at=excluded.updated_at
        """, (
            p["id"], p.get("code"),
            p["web_name"],
            f"{p['first_name']} {p['second_name']}",
            p["team"],
            POSITION_MAP.get(p["element_type"], "UNK"),
            p["now_cost"] / 10.0,
            p["total_points"],
            float(p["points_per_game"] or 0),
            float(p["form"] or 0),
            float(p.get("selected_by_percent") or p.get("selected_by_pct") or 0),
            p["minutes"],
            p["goals_scored"],
            p["assists"],
            p["clean_sheets"],
            p["bonus"],
            float(p["ict_index"] or 0),
            p.get("news", ""),
            p.get("chance_of_playing_next_round"),
            p["status"],
            p.get("transfers_in_event", 0),
            p.get("transfers_out_event", 0),
            now
        ))

    for gw in data["events"]:
        c.execute("""
            INSERT OR REPLACE INTO gameweeks VALUES (?,?,?,?,?,?,?,?)
        """, (
            gw["id"], gw["name"], gw["deadline_time"],
            int(gw["finished"]), int(gw["is_current"]), int(gw["is_next"]),
            gw.get("average_entry_score"), gw.get("highest_score")
        ))

    conn.commit()
    conn.close()
    print(f"✅ Synced {len(data['elements'])} players, {len(data['teams'])} teams, {len(data['events'])} gameweeks.")


def sync_fixtures(db_path: str = "fpl.db"):
    print("📡 Fetching fixtures...")
    fixtures = get_fixtures()
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    for f in fixtures:
        c.execute("""
            INSERT OR REPLACE INTO fixtures VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (
            f["id"], f.get("event"), f["team_h"], f["team_a"],
            f["team_h_difficulty"], f["team_a_difficulty"],
            f.get("team_h_score"), f.get("team_a_score"),
            int(f["finished"]), f.get("kickoff_time")
        ))

    conn.commit()
    conn.close()
    print(f"✅ Synced {len(fixtures)} fixtures.")


def sync_player_histories(db_path: str = "fpl.db", limit: int = None):
    """Sync per-player GW history including per-GW xG and xA from FPL API."""
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("SELECT id FROM players ORDER BY total_points DESC")
    player_ids = [row[0] for row in c.fetchall()]
    conn.close()

    if limit:
        player_ids = player_ids[:limit]

    print(f"📡 Syncing history for {len(player_ids)} players...")

    for i, pid in enumerate(player_ids):
        try:
            data = get_player_history(pid)
            conn = sqlite3.connect(db_path)
            c = conn.cursor()
            for gw in data["history"]:
                c.execute("""
                    INSERT OR REPLACE INTO player_gameweek_history
                    (player_id, gameweek, total_points, minutes, goals_scored,
                     assists, clean_sheets, bonus, bps, ict_index, value, selected,
                     transfers_in, transfers_out,
                     expected_goals, expected_assists, expected_goal_involvements)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    pid,
                    gw["round"],
                    gw["total_points"],
                    gw["minutes"],
                    gw["goals_scored"],
                    gw["assists"],
                    gw["clean_sheets"],
                    gw["bonus"],
                    gw["bps"],
                    float(gw["ict_index"] or 0),
                    gw["value"] / 10.0,
                    gw["selected"],
                    gw["transfers_in"],
                    gw["transfers_out"],
                    float(gw.get("expected_goals") or 0),
                    float(gw.get("expected_assists") or 0),
                    float(gw.get("expected_goal_involvements") or 0),
                ))
            conn.commit()
            conn.close()
            if (i + 1) % 50 == 0:
                print(f"  ... {i+1}/{len(player_ids)}")
        except Exception as e:
            print(f"  ⚠️  Failed for player {pid}: {e}")

    print("✅ Player histories synced.")


# ── xG INTEGRATION ────────────────────────────────────────────────────────────

def fetch_understat_xg() -> dict:
    print(f"📡 Fetching Understat xG data for EPL {UNDERSTAT_SEASON}...")
    xg_data = {}

    try:
        with UnderstatClient() as understat:
            players = understat.league(league="EPL").get_player_data(season=UNDERSTAT_SEASON)

        for p in players:
            try:
                minutes = float(p.get("time", 0) or 0)
                if minutes < 90:
                    continue
                nineties = minutes / 90.0
                xg  = float(p.get("xG", 0) or 0)
                xa  = float(p.get("xA", 0) or 0)
                xgi = xg + xa

                xg_data[p["player_name"]] = {
                    "xg_per90":  round(xg  / nineties, 3),
                    "xa_per90":  round(xa  / nineties, 3),
                    "xgi_per90": round(xgi / nineties, 3),
                    "minutes":   int(minutes),
                }
            except (ValueError, TypeError, KeyError):
                continue

        print(f"✅ Understat: got xG data for {len(xg_data)} players")

    except Exception as e:
        print(f"⚠️  Understat fetch failed: {e}. xG data skipped.")

    return xg_data


def fuzzy_match_xg(fpl_players: list, xg_data: dict) -> dict:
    if not xg_data:
        return {}

    understat_names = list(xg_data.keys())
    matched = {}
    unmatched = []

    for fpl_id, full_name, web_name in fpl_players:
        best_match = None
        best_score = 0

        for query in [full_name, web_name]:
            if not query:
                continue
            result = process.extractOne(
                query, understat_names,
                scorer=fuzz.token_sort_ratio,
                score_cutoff=78,
            )
            if result and result[1] > best_score:
                best_match = result
                best_score = result[1]

        if best_match:
            us_name, score, _ = best_match
            matched[fpl_id] = {**xg_data[us_name]}
        else:
            unmatched.append(full_name)

    print(f"✅ Fuzzy matched {len(matched)}/{len(fpl_players)} FPL players to Understat")
    if unmatched[:5]:
        print(f"   Unmatched examples: {unmatched[:5]}")

    return matched


def sync_xg(db_path: str = "fpl.db"):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("SELECT id, full_name, web_name FROM players")
    fpl_players = c.fetchall()
    conn.close()

    xg_data = fetch_understat_xg()
    if not xg_data:
        print("⚠️  No xG data fetched — skipping DB update.")
        return

    matched = fuzzy_match_xg(fpl_players, xg_data)
    if not matched:
        print("⚠️  No players matched — skipping DB update.")
        return

    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    for fpl_id, stats in matched.items():
        c.execute("""
            UPDATE players
            SET xg_per90  = ?,
                xa_per90  = ?,
                xgi_per90 = ?
            WHERE id = ?
        """, (stats["xg_per90"], stats["xa_per90"], stats["xgi_per90"], fpl_id))
    conn.commit()
    conn.close()
    print(f"✅ xG data stored for {len(matched)} players.")


# ── SYNC ENTRY POINTS ─────────────────────────────────────────────────────────

def full_sync(db_path: str = "fpl.db"):
    init_db(db_path)
    sync_bootstrap(db_path)
    sync_fixtures(db_path)
    sync_player_histories(db_path)
    sync_xg(db_path)
    print("🎉 Full sync complete!")


if __name__ == "__main__":
    full_sync()