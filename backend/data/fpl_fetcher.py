"""
FPL Data Fetcher
Pulls data from the official Fantasy Premier League API.
Endpoints used:
  - /bootstrap-static/  → all players, teams, gameweeks
  - /element-summary/{id}/ → per-player gameweek history
  - /fixtures/ → full fixture list with FDR
"""

import requests
import sqlite3
import json
from datetime import datetime

BASE_URL = "https://fantasy.premierleague.com/api"

HEADERS = {
    "User-Agent": "Mozilla/5.0"
}


def get_bootstrap():
    """Fetch the main FPL bootstrap data (players, teams, GW info)."""
    r = requests.get(f"{BASE_URL}/bootstrap-static/", headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def get_fixtures():
    """Fetch all fixtures with FDR ratings."""
    r = requests.get(f"{BASE_URL}/fixtures/", headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def get_player_history(player_id: int):
    """Fetch gameweek-by-gameweek history for a single player."""
    r = requests.get(f"{BASE_URL}/element-summary/{player_id}/", headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def init_db(db_path: str = "fpl.db"):
    """Create the SQLite database schema."""
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
            position TEXT,   -- GKP, DEF, MID, FWD
            price REAL,      -- in millions
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

    conn.commit()
    conn.close()
    print("✅ Database schema created.")


POSITION_MAP = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}


def sync_bootstrap(db_path: str = "fpl.db"):
    """Sync teams, players, and gameweeks from bootstrap."""
    print("📡 Fetching bootstrap data...")
    data = get_bootstrap()
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    now = datetime.utcnow().isoformat()

    # Teams
    for t in data["teams"]:
        c.execute("""
            INSERT OR REPLACE INTO teams VALUES (?,?,?,?,?,?,?,?)
        """, (t["id"], t["name"], t["short_name"], t["strength"],
              t["strength_attack_home"], t["strength_attack_away"],
              t["strength_defence_home"], t["strength_defence_away"]))

    # Players
    for p in data["elements"]:
        c.execute("""
           INSERT OR REPLACE INTO players VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    )
        """, (
            p["id"],
            p.get("code"),
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

    # Gameweeks
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
    """Sync fixture data."""
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
    """Sync per-player GW history. limit=None syncs all players (slow first time)."""
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
                     transfers_in, transfers_out)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    pid, gw["round"], gw["total_points"], gw["minutes"],
                    gw["goals_scored"], gw["assists"], gw["clean_sheets"],
                    gw["bonus"], gw["bps"], float(gw["ict_index"] or 0),
                    gw["value"] / 10.0, gw["selected"], gw["transfers_in"],
                    gw["transfers_out"]
                ))
            conn.commit()
            conn.close()
            if (i + 1) % 50 == 0:
                print(f"  ... {i+1}/{len(player_ids)}")
        except Exception as e:
            print(f"  ⚠️  Failed for player {pid}: {e}")

    print("✅ Player histories synced.")


def full_sync(db_path: str = "fpl.db"):
    """Run a complete data sync."""
    init_db(db_path)
    sync_bootstrap(db_path)
    sync_fixtures(db_path)
    sync_player_histories(db_path)
    print("🎉 Full sync complete!")


if __name__ == "__main__":
    full_sync()
