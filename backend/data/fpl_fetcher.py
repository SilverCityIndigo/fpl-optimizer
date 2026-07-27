"""
FPL Data Fetcher — Postgres/Supabase version.

Data sources
------------
* Official FPL REST API — teams, players, gameweeks, fixtures, per-GW stats,
  and (new for 25/26+) per-90 expected stats served straight from
  ``bootstrap-static``.  This is the auto-updating hot path: every sync pulls
  the latest numbers with no scraping and no manual step.
* Understat — only used to *seed* underlying stats for players who are brand
  new to the Premier League (arrivals from other leagues) so the projection
  algorithm has something to work with before they have played a PL minute.

Season handling
---------------
The projection algorithm needs xG/xA and a points baseline.  At the start of a
season nobody has played, so those come from a "seed":

* Returning players  -> their last completed PL season (FPL ``history_past``),
  matched by player id (reliable, no fuzzy matching).
* New arrivals       -> Understat foreign-league data, fuzzy-matched by name
  (best effort, flagged via ``xg_source``).

As real 26/27 minutes accumulate, ``compute_projections`` blends the live
current-season numbers in and the seed out, so the tool is useful on day one
and self-corrects as the season plays out.
"""

import os
import sys
import argparse
import unicodedata
import requests
import psycopg2
from datetime import datetime, timezone

BASE_URL = "https://fantasy.premierleague.com/api"
HEADERS = {"User-Agent": "Mozilla/5.0"}

# Season the *current* campaign maps to on Understat (used only if we ever want
# live Understat EPL data; the hot path now reads xG from FPL bootstrap).
UNDERSTAT_CURRENT_SEASON = os.environ.get("UNDERSTAT_SEASON", "2026")
# Last completed season, used to seed newcomers from foreign leagues.
UNDERSTAT_SEED_SEASON = os.environ.get("UNDERSTAT_SEED_SEASON", "2025")

# Understat league codes to scan for new-arrival seeding.
# These must match understatapi's accepted identifiers exactly
# (["EPL", "La_Liga", "Bundesliga", "Serie_A", "Ligue_1", "RFPL"]).
FOREIGN_LEAGUES = ["La_Liga", "Serie_A", "Bundesliga", "Ligue_1", "RFPL"]

POSITION_MAP = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- #
# HTTP helpers                                                                 #
# --------------------------------------------------------------------------- #

def get_bootstrap():
    r = requests.get(f"{BASE_URL}/bootstrap-static/", headers=HEADERS, timeout=20)
    r.raise_for_status()
    return r.json()


def get_fixtures():
    r = requests.get(f"{BASE_URL}/fixtures/", headers=HEADERS, timeout=20)
    r.raise_for_status()
    return r.json()


def get_player_history(player_id: int):
    r = requests.get(f"{BASE_URL}/element-summary/{player_id}/", headers=HEADERS, timeout=20)
    r.raise_for_status()
    return r.json()


def get_event_live(gw: int):
    """Bulk per-player stats for a single gameweek — one HTTP call covers everyone."""
    r = requests.get(f"{BASE_URL}/event/{gw}/live/", headers=HEADERS, timeout=20)
    r.raise_for_status()
    return r.json()


def season_has_started(events: list) -> bool:
    """True once any gameweek of the current campaign has finished. Before that
    we are in pre-season and the bootstrap's cumulative fields (minutes, points,
    ppg) still echo last season, so we treat current-season sample size as 0."""
    return any(e.get("finished") for e in events)


def _f(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _per90(total, minutes) -> float:
    m = _f(minutes)
    if m < 1:
        return 0.0
    return round(_f(total) / (m / 90.0), 3)


def _season_label(events: list) -> str:
    """Derive a season label ('2026/27') from GW1's deadline year.

    FPL reassigns player ids every season, so per-gameweek history rows must be
    stamped with the season they belong to. Without it, last season's rows for
    player id N silently become the history of whoever inherits id N."""
    first = next((e.get("deadline_time") for e in events if e.get("id") == 1), None)
    if not first:
        deadlines = sorted(str(e.get("deadline_time") or "") for e in events)
        first = deadlines[0] if deadlines else ""
    try:
        year = int(str(first)[:4])
    except (ValueError, TypeError):
        return ""
    return f"{year}/{str(year + 1)[-2:]}"


def _season_from_db(c) -> str:
    """Season label derived from the gameweeks table (populated by bootstrap)."""
    c.execute("SELECT id, deadline_time FROM gameweeks")
    events = [{"id": r[0], "deadline_time": r[1]} for r in c.fetchall()]
    return _season_label(events)


def _ascii_fold(text: str) -> str:
    """Strip diacritics and lowercase, so FPL's stripped/common names
    (Dembele) match Understat's accented forms (Dembélé) when fuzzy matching."""
    if not text:
        return ""
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(c for c in normalized if not unicodedata.combining(c)).lower().strip()


# --------------------------------------------------------------------------- #
# Schema (idempotent — safe to run against a fresh or existing Supabase DB)    #
# --------------------------------------------------------------------------- #

def init_db():
    """Create tables if missing and add any new columns. Idempotent, so it can
    run on every sync. Existing tables/data are never dropped."""
    conn = get_conn()
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY,
            name TEXT, short_name TEXT, strength INTEGER,
            strength_attack_home INTEGER, strength_attack_away INTEGER,
            strength_defence_home INTEGER, strength_defence_away INTEGER
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY,
            code INTEGER, web_name TEXT, full_name TEXT,
            team_id INTEGER, position TEXT, price DOUBLE PRECISION,
            total_points INTEGER, points_per_game DOUBLE PRECISION,
            form DOUBLE PRECISION, selected_by_percent DOUBLE PRECISION,
            minutes INTEGER, goals_scored INTEGER, assists INTEGER,
            clean_sheets INTEGER, bonus INTEGER, ict_index DOUBLE PRECISION,
            news TEXT, chance_of_playing_next_round INTEGER, status TEXT,
            transfers_in_event INTEGER, transfers_out_event INTEGER,
            xg_per90 DOUBLE PRECISION DEFAULT 0.0,
            xa_per90 DOUBLE PRECISION DEFAULT 0.0,
            xgi_per90 DOUBLE PRECISION DEFAULT 0.0,
            updated_at TEXT
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS gameweeks (
            id INTEGER PRIMARY KEY,
            name TEXT, deadline_time TEXT,
            finished INTEGER, is_current INTEGER, is_next INTEGER,
            average_entry_score INTEGER, highest_score INTEGER
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS fixtures (
            id INTEGER PRIMARY KEY,
            gameweek INTEGER, team_h INTEGER, team_a INTEGER,
            team_h_difficulty INTEGER, team_a_difficulty INTEGER,
            team_h_score INTEGER, team_a_score INTEGER,
            finished INTEGER, kickoff_time TEXT
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS player_gameweek_history (
            player_id INTEGER, gameweek INTEGER,
            total_points INTEGER, minutes INTEGER,
            goals_scored INTEGER, assists INTEGER, clean_sheets INTEGER,
            bonus INTEGER, bps INTEGER, ict_index DOUBLE PRECISION,
            value DOUBLE PRECISION, selected INTEGER,
            transfers_in INTEGER, transfers_out INTEGER,
            expected_goals DOUBLE PRECISION, expected_assists DOUBLE PRECISION,
            expected_goal_involvements DOUBLE PRECISION,
            expected_goals_conceded DOUBLE PRECISION,
            saves INTEGER, defensive_contribution INTEGER,
            clearances_blocks_interceptions INTEGER, recoveries INTEGER,
            tackles INTEGER, influence DOUBLE PRECISION,
            creativity DOUBLE PRECISION, threat DOUBLE PRECISION,
            yellow_cards INTEGER, red_cards INTEGER, own_goals INTEGER,
            penalties_saved INTEGER, penalties_missed INTEGER,
            PRIMARY KEY (player_id, gameweek)
        )
    """)

    # New columns for seeding + precomputed projections. ADD ... IF NOT EXISTS
    # so existing Supabase tables get upgraded in place.
    new_cols = [
        ("players", "seed_xg90", "DOUBLE PRECISION DEFAULT 0.0"),
        ("players", "seed_xa90", "DOUBLE PRECISION DEFAULT 0.0"),
        ("players", "seed_ppg", "DOUBLE PRECISION DEFAULT 0.0"),
        ("players", "last_season_points", "INTEGER DEFAULT 0"),
        ("players", "last_season_minutes", "INTEGER DEFAULT 0"),
        ("players", "xg_source", "TEXT DEFAULT ''"),
        ("players", "projected_points", "DOUBLE PRECISION"),
        ("players", "projected_updated_at", "TEXT"),
        ("player_gameweek_history", "season", "TEXT"),
        # Guard against older schemas missing the newer stat columns.
        ("player_gameweek_history", "defensive_contribution", "INTEGER DEFAULT 0"),
        ("player_gameweek_history", "clearances_blocks_interceptions", "INTEGER DEFAULT 0"),
        ("player_gameweek_history", "recoveries", "INTEGER DEFAULT 0"),
        ("player_gameweek_history", "tackles", "INTEGER DEFAULT 0"),
    ]
    for table, col, coltype in new_cols:
        c.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {coltype}")

    conn.commit()
    conn.close()
    print("✅ Schema ready (tables + columns ensured).")


# --------------------------------------------------------------------------- #
# Bootstrap: teams, players (incl. live current-season xG), gameweeks          #
# --------------------------------------------------------------------------- #

def sync_bootstrap():
    print("📡 Fetching bootstrap data...")
    data = get_bootstrap()
    started = season_has_started(data["events"])
    conn = get_conn()
    c = conn.cursor()
    now = _now_iso()

    for t in data["teams"]:
        c.execute("""
            INSERT INTO teams (id, name, short_name, strength,
                strength_attack_home, strength_attack_away,
                strength_defence_home, strength_defence_away)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(id) DO UPDATE SET
                name=EXCLUDED.name, short_name=EXCLUDED.short_name,
                strength=EXCLUDED.strength,
                strength_attack_home=EXCLUDED.strength_attack_home,
                strength_attack_away=EXCLUDED.strength_attack_away,
                strength_defence_home=EXCLUDED.strength_defence_home,
                strength_defence_away=EXCLUDED.strength_defence_away
        """, (t["id"], t["name"], t["short_name"], t["strength"],
              t["strength_attack_home"], t["strength_attack_away"],
              t["strength_defence_home"], t["strength_defence_away"]))

    for p in data["elements"]:
        # Current-season per-90 expected stats come straight from FPL now.
        # Pre-season these are 0.0; the seed columns cover that gap and
        # compute_projections() blends the two by real minutes played.
        cur_xg90 = _f(p.get("expected_goals_per_90"))
        cur_xa90 = _f(p.get("expected_assists_per_90"))
        cur_xgi90 = _f(p.get("expected_goal_involvements_per_90"))

        c.execute("""
            INSERT INTO players (
                id, code, web_name, full_name, team_id, position, price,
                total_points, points_per_game, form, selected_by_percent,
                minutes, goals_scored, assists, clean_sheets, bonus,
                ict_index, news, chance_of_playing_next_round, status,
                transfers_in_event, transfers_out_event,
                xg_per90, xa_per90, xgi_per90, updated_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(id) DO UPDATE SET
                code=EXCLUDED.code, web_name=EXCLUDED.web_name,
                full_name=EXCLUDED.full_name, team_id=EXCLUDED.team_id,
                position=EXCLUDED.position, price=EXCLUDED.price,
                total_points=EXCLUDED.total_points,
                points_per_game=EXCLUDED.points_per_game,
                form=EXCLUDED.form,
                selected_by_percent=EXCLUDED.selected_by_percent,
                minutes=EXCLUDED.minutes, goals_scored=EXCLUDED.goals_scored,
                assists=EXCLUDED.assists, clean_sheets=EXCLUDED.clean_sheets,
                bonus=EXCLUDED.bonus, ict_index=EXCLUDED.ict_index,
                news=EXCLUDED.news,
                chance_of_playing_next_round=EXCLUDED.chance_of_playing_next_round,
                status=EXCLUDED.status,
                transfers_in_event=EXCLUDED.transfers_in_event,
                transfers_out_event=EXCLUDED.transfers_out_event,
                xg_per90=EXCLUDED.xg_per90, xa_per90=EXCLUDED.xa_per90,
                xgi_per90=EXCLUDED.xgi_per90,
                updated_at=EXCLUDED.updated_at
        """, (
            p["id"], p.get("code"),
            p["web_name"],
            f"{p['first_name']} {p['second_name']}",
            p["team"],
            POSITION_MAP.get(p["element_type"], "UNK"),
            p["now_cost"] / 10.0,
            p["total_points"],
            _f(p.get("points_per_game")),
            _f(p.get("form")),
            _f(p.get("selected_by_percent") or p.get("selected_by_pct")),
            p["minutes"], p["goals_scored"], p["assists"], p["clean_sheets"],
            p["bonus"], _f(p.get("ict_index")),
            p.get("news", ""), p.get("chance_of_playing_next_round"),
            p["status"],
            p.get("transfers_in_event", 0), p.get("transfers_out_event", 0),
            cur_xg90, cur_xa90, cur_xgi90,
            now
        ))

    for gw in data["events"]:
        c.execute("""
            INSERT INTO gameweeks (id, name, deadline_time, finished,
                is_current, is_next, average_entry_score, highest_score)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(id) DO UPDATE SET
                name=EXCLUDED.name, deadline_time=EXCLUDED.deadline_time,
                finished=EXCLUDED.finished, is_current=EXCLUDED.is_current,
                is_next=EXCLUDED.is_next,
                average_entry_score=EXCLUDED.average_entry_score,
                highest_score=EXCLUDED.highest_score
        """, (
            gw["id"], gw["name"], gw["deadline_time"],
            int(gw["finished"]), int(gw["is_current"]), int(gw["is_next"]),
            gw.get("average_entry_score"), gw.get("highest_score")
        ))

    # Prune leftovers from previous seasons. FPL reassigns element and team ids
    # every season, so any row not present in the current bootstrap is last
    # season's stale copy — leaving it in place makes the same player appear
    # twice (old id/team + new id/team). Guarded so a bad/empty API response can
    # never wipe the tables.
    pruned = ""
    if len(data["elements"]) > 100 and len(data["teams"]) >= 15:
        cur_players = [p["id"] for p in data["elements"]]
        cur_teams = [t["id"] for t in data["teams"]]
        c.execute("DELETE FROM players WHERE NOT (id = ANY(%s))", (cur_players,))
        dp = c.rowcount or 0
        c.execute("DELETE FROM teams WHERE NOT (id = ANY(%s))", (cur_teams,))
        dt = c.rowcount or 0
        c.execute("DELETE FROM player_gameweek_history WHERE NOT (player_id = ANY(%s))",
                  (cur_players,))
        dh = c.rowcount or 0
        # Drop history rows belonging to a different season. Ids are reused, so
        # id-based pruning alone can't catch last season's rows for a player id
        # that still exists — they'd be misread as this season's form.
        season = _season_label(data["events"])
        if season:
            c.execute(
                "DELETE FROM player_gameweek_history WHERE season IS DISTINCT FROM %s",
                (season,),
            )
            dh += c.rowcount or 0
        if dp or dt or dh:
            pruned = f" 🧹 pruned {dp} stale players / {dt} teams / {dh} history rows."

    conn.commit()
    conn.close()
    label = "in-season" if started else "pre-season"
    print(f"✅ Synced {len(data['elements'])} players, {len(data['teams'])} teams ({label}).{pruned}")


def sync_fixtures():
    print("📡 Fetching fixtures...")
    fixtures = get_fixtures()
    conn = get_conn()
    c = conn.cursor()
    for f in fixtures:
        c.execute("""
            INSERT INTO fixtures (id, gameweek, team_h, team_a,
                team_h_difficulty, team_a_difficulty,
                team_h_score, team_a_score, finished, kickoff_time)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(id) DO UPDATE SET
                gameweek=EXCLUDED.gameweek,
                -- team_h/team_a MUST be updated: FPL reuses fixture ids 1..380
                -- every season, so an existing row would otherwise keep last
                -- season's two teams while taking on this season's gameweek and
                -- difficulty (e.g. showing "LIV vs ARS" for a 26/27 GW1 that is
                -- actually ARS vs COV).
                team_h=EXCLUDED.team_h,
                team_a=EXCLUDED.team_a,
                team_h_difficulty=EXCLUDED.team_h_difficulty,
                team_a_difficulty=EXCLUDED.team_a_difficulty,
                team_h_score=EXCLUDED.team_h_score,
                team_a_score=EXCLUDED.team_a_score,
                finished=EXCLUDED.finished,
                kickoff_time=EXCLUDED.kickoff_time
        """, (
            f["id"], f.get("event"), f["team_h"], f["team_a"],
            f["team_h_difficulty"], f["team_a_difficulty"],
            f.get("team_h_score"), f.get("team_a_score"),
            int(f["finished"]), f.get("kickoff_time")
        ))
    # Prune last season's fixtures (fixture ids are reassigned each season too).
    pruned = ""
    if fixtures:
        c.execute("DELETE FROM fixtures WHERE NOT (id = ANY(%s))", ([f["id"] for f in fixtures],))
        df = c.rowcount or 0
        if df:
            pruned = f" 🧹 pruned {df} stale fixtures."
    conn.commit()
    conn.close()
    print(f"✅ Synced {len(fixtures)} fixtures.{pruned}")


# --------------------------------------------------------------------------- #
# Per-gameweek history (current season) + last-season seeding (one pass)       #
# --------------------------------------------------------------------------- #

def _aggregate_history_by_round(history: list) -> list:
    """Collapse multiple history rows for the same gameweek (double GWs) into one
    row with summed stats. FPL returns one entry per fixture, so DGW players have
    two rows with the same `round`; without aggregation our UPSERT would silently
    drop the first fixture's stats."""
    by_round: dict[int, dict] = {}
    sum_int = ["total_points", "minutes", "goals_scored", "assists",
               "clean_sheets", "bonus", "bps", "saves", "yellow_cards",
               "red_cards", "own_goals", "penalties_saved", "penalties_missed",
               "transfers_in", "transfers_out",
               "defensive_contribution", "clearances_blocks_interceptions",
               "recoveries", "tackles"]
    sum_float = ["expected_goals", "expected_assists",
                 "expected_goal_involvements", "expected_goals_conceded",
                 "ict_index", "influence", "creativity", "threat"]
    last_wins = ["value", "selected"]

    for row in history:
        rnd = row["round"]
        if rnd not in by_round:
            by_round[rnd] = {**row}
            continue
        agg = by_round[rnd]
        for k in sum_int:
            agg[k] = (int(agg.get(k) or 0)) + (int(row.get(k) or 0))
        for k in sum_float:
            agg[k] = float(agg.get(k) or 0) + float(row.get(k) or 0)
        for k in last_wins:
            agg[k] = row.get(k, agg.get(k))
    return list(by_round.values())


def _latest_past_season(history_past: list) -> dict | None:
    """Pick the most recent completed PL season entry from element-summary
    history_past (each has season_name like '2025/26')."""
    best, best_year = None, -1
    for entry in history_past or []:
        name = str(entry.get("season_name", ""))
        try:
            year = int(name[:4])
        except (ValueError, TypeError):
            year = -1
        if year >= best_year and _f(entry.get("minutes")) > 0:
            best, best_year = entry, year
    return best


def _seed_from_past(c, player_id: int, position: str, past: dict) -> None:
    """Write last-season baseline (xG/90, xA/90, points/90, totals) for a
    returning player. Keyed by id, so no name matching needed."""
    minutes = int(_f(past.get("minutes")))
    points = int(_f(past.get("total_points")))
    seed_xg90 = _per90(past.get("expected_goals"), minutes)
    seed_xa90 = _per90(past.get("expected_assists"), minutes)
    # Points per 90 as a per-GW baseline for the form-decay fallback.
    seed_ppg = round(points / max(1.0, minutes / 90.0), 3)
    c.execute("""
        UPDATE players SET
            seed_xg90=%s, seed_xa90=%s, seed_ppg=%s,
            last_season_points=%s, last_season_minutes=%s,
            xg_source='fpl_hist'
        WHERE id=%s
    """, (seed_xg90, seed_xa90, seed_ppg, points, minutes, player_id))


def sync_player_histories(limit: int = None, seed: bool = True):
    """For every player: (1) upsert current-season per-GW history rows, and
    (2) if `seed`, derive the last-season baseline from history_past in the same
    HTTP call. One element-summary request per player."""
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT id, position FROM players ORDER BY total_points DESC")
    player_rows = c.fetchall()
    season = _season_from_db(c)
    conn.close()

    if limit:
        player_rows = player_rows[:limit]

    print(f"📡 Syncing history/seed for {len(player_rows)} players...")
    seeded = 0

    for i, (pid, position) in enumerate(player_rows):
        try:
            data = get_player_history(pid)
            conn = get_conn()
            c = conn.cursor()

            for gw in _aggregate_history_by_round(data.get("history", [])):
                c.execute("""
                    INSERT INTO player_gameweek_history (
                        player_id, gameweek, total_points, minutes,
                        goals_scored, assists, clean_sheets, bonus, bps,
                        ict_index, value, selected, transfers_in, transfers_out,
                        expected_goals, expected_assists, expected_goal_involvements,
                        expected_goals_conceded, saves, defensive_contribution,
                        clearances_blocks_interceptions, recoveries, tackles,
                        influence, creativity, threat,
                        yellow_cards, red_cards, own_goals,
                        penalties_saved, penalties_missed, season
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT(player_id, gameweek) DO UPDATE SET
                        season=EXCLUDED.season,
                        total_points=EXCLUDED.total_points,
                        minutes=EXCLUDED.minutes,
                        goals_scored=EXCLUDED.goals_scored,
                        assists=EXCLUDED.assists,
                        clean_sheets=EXCLUDED.clean_sheets,
                        bonus=EXCLUDED.bonus, bps=EXCLUDED.bps,
                        ict_index=EXCLUDED.ict_index,
                        value=EXCLUDED.value, selected=EXCLUDED.selected,
                        transfers_in=EXCLUDED.transfers_in,
                        transfers_out=EXCLUDED.transfers_out,
                        expected_goals=EXCLUDED.expected_goals,
                        expected_assists=EXCLUDED.expected_assists,
                        expected_goal_involvements=EXCLUDED.expected_goal_involvements,
                        expected_goals_conceded=EXCLUDED.expected_goals_conceded,
                        saves=EXCLUDED.saves,
                        defensive_contribution=EXCLUDED.defensive_contribution,
                        clearances_blocks_interceptions=EXCLUDED.clearances_blocks_interceptions,
                        recoveries=EXCLUDED.recoveries,
                        tackles=EXCLUDED.tackles,
                        influence=EXCLUDED.influence,
                        creativity=EXCLUDED.creativity,
                        threat=EXCLUDED.threat,
                        yellow_cards=EXCLUDED.yellow_cards,
                        red_cards=EXCLUDED.red_cards
                """, (
                    pid, gw["round"], gw["total_points"], gw["minutes"],
                    gw["goals_scored"], gw["assists"], gw["clean_sheets"],
                    gw["bonus"], gw["bps"],
                    _f(gw.get("ict_index")),
                    gw["value"] / 10.0, gw["selected"],
                    gw["transfers_in"], gw["transfers_out"],
                    _f(gw.get("expected_goals")),
                    _f(gw.get("expected_assists")),
                    _f(gw.get("expected_goal_involvements")),
                    _f(gw.get("expected_goals_conceded")),
                    int(_f(gw.get("saves"))),
                    int(_f(gw.get("defensive_contribution"))),
                    int(_f(gw.get("clearances_blocks_interceptions"))),
                    int(_f(gw.get("recoveries"))),
                    int(_f(gw.get("tackles"))),
                    _f(gw.get("influence")),
                    _f(gw.get("creativity")),
                    _f(gw.get("threat")),
                    int(_f(gw.get("yellow_cards"))),
                    int(_f(gw.get("red_cards"))),
                    int(_f(gw.get("own_goals"))),
                    int(_f(gw.get("penalties_saved"))),
                    int(_f(gw.get("penalties_missed"))),
                    season,
                ))

            if seed:
                past = _latest_past_season(data.get("history_past", []))
                if past:
                    _seed_from_past(c, pid, position, past)
                    seeded += 1

            conn.commit()
            conn.close()
            if (i + 1) % 50 == 0:
                print(f"  ... {i+1}/{len(player_rows)}")
        except Exception as e:
            print(f"  ⚠️  Failed for player {pid}: {e}")

    print(f"✅ Player histories synced. Seeded {seeded} returning players from last season.")


# --------------------------------------------------------------------------- #
# Understat foreign-league seeding for brand-new PL players                    #
# --------------------------------------------------------------------------- #

def _fetch_understat_league(understat, league: str, season: str) -> dict:
    """Return {player_name: {xg_per90, xa_per90, minutes}} for one league/season."""
    out = {}
    try:
        players = understat.league(league=league).get_player_data(season=season)
    except Exception as e:
        print(f"  ⚠️  Understat {league} {season} failed: {e}")
        return out
    for p in players:
        minutes = _f(p.get("time"))
        if minutes < 300:  # need a meaningful sample to trust the rate
            continue
        nineties = minutes / 90.0
        out[p.get("player_name", "")] = {
            "xg_per90": round(_f(p.get("xG")) / nineties, 3),
            "xa_per90": round(_f(p.get("xA")) / nineties, 3),
            "minutes": int(minutes),
        }
    return out


def sync_understat_newcomers():
    """Seed underlying stats for players with no last-season PL baseline
    (xg_source still ''), by fuzzy-matching their name across Understat's other
    leagues. Best effort — unmatched players simply keep the position/price
    priors used by the projection algorithm."""
    from understatapi import UnderstatClient
    from rapidfuzz import process, fuzz

    conn = get_conn()
    c = conn.cursor()
    c.execute("""
        SELECT id, full_name, web_name, position
        FROM players
        WHERE COALESCE(xg_source, '') = '' AND status != 'u'
    """)
    newcomers = c.fetchall()
    conn.close()

    if not newcomers:
        print("✅ No un-seeded newcomers to match.")
        return

    print(f"📡 Seeding {len(newcomers)} newcomers from Understat foreign leagues...")
    combined: dict = {}
    with UnderstatClient() as understat:
        for league in FOREIGN_LEAGUES:
            league_data = _fetch_understat_league(understat, league, UNDERSTAT_SEED_SEASON)
            # Keep the highest-minutes entry when a name appears in several leagues.
            for name, stats in league_data.items():
                if name not in combined or stats["minutes"] > combined[name]["minutes"]:
                    combined[name] = stats
            print(f"   {league}: {len(league_data)} players (>=300 min)")

    if not combined:
        print("⚠️  No Understat foreign data available — skipping newcomer seed.")
        return

    # Match on accent-folded names (Understat stores accented/legal forms;
    # FPL stores stripped/common ones). Keep the highest-minutes stats on any
    # folded-name collision.
    folded_index: dict[str, dict] = {}
    for name, stats in combined.items():
        key = _ascii_fold(name)
        if key not in folded_index or stats["minutes"] > folded_index[key]["minutes"]:
            folded_index[key] = stats
    folded_names = list(folded_index.keys())

    matched = 0
    conn = get_conn()
    c = conn.cursor()
    for pid, full_name, web_name, position in newcomers:
        best = None
        best_score = 0
        for query in [full_name, web_name]:
            if not query:
                continue
            res = process.extractOne(_ascii_fold(query), folded_names,
                                     scorer=fuzz.token_sort_ratio, score_cutoff=80)
            if res and res[1] > best_score:
                best, best_score = res, res[1]
        if not best:
            continue
        stats = folded_index[best[0]]
        xg90, xa90, mins = stats["xg_per90"], stats["xa_per90"], stats["minutes"]
        # Rough FPL points/90 prior for a newcomer, driven by their attacking
        # output abroad. Deliberately conservative: translation across leagues
        # is uncertain, so we lean on xG rather than inventing a points history.
        xg_signal = _position_xg_signal(position, xg90, xa90)
        seed_ppg = round(2.0 + 0.6 * xg_signal, 3)
        c.execute("""
            UPDATE players SET
                seed_xg90=%s, seed_xa90=%s, seed_ppg=%s,
                last_season_minutes=%s, xg_source='understat_foreign'
            WHERE id=%s
        """, (xg90, xa90, seed_ppg, mins, pid))
        matched += 1
    conn.commit()
    conn.close()
    print(f"✅ Seeded {matched}/{len(newcomers)} newcomers from Understat.")


def _position_xg_signal(position: str, xg90: float, xa90: float) -> float:
    """Positional weighting of attacking rate — mirrors the projection blend so
    the newcomer points prior is consistent with in-season scoring."""
    if position == "DEF":
        return xa90 * 3.0
    if position == "MID":
        return xg90 * 5.0 + xa90 * 3.0
    if position == "FWD":
        return xg90 * 4.0 + xa90 * 3.0
    return 0.0


# --------------------------------------------------------------------------- #
# Live per-gameweek refresh (fast path during the season)                      #
# --------------------------------------------------------------------------- #

def sync_event_live(gw: int) -> int:
    """Sync per-player stats for a single gameweek using FPL's bulk live
    endpoint. One HTTP call covers every player. Returns rows touched."""
    print(f"📡 Fetching live stats for GW{gw}...")
    try:
        data = get_event_live(gw)
    except Exception as e:
        print(f"  ⚠️  GW{gw} live fetch failed: {e}")
        return 0

    elements = data.get("elements", [])
    if not elements:
        return 0

    conn = get_conn()
    c = conn.cursor()
    season = _season_from_db(c)

    c.execute("""
        SELECT DISTINCT p.id, p.price
        FROM players p
        JOIN fixtures f ON (f.team_h = p.team_id OR f.team_a = p.team_id)
        WHERE f.gameweek = %s
    """, (gw,))
    eligible: dict[int, float] = {row[0]: float(row[1] or 0) for row in c.fetchall()}

    touched = 0
    for el in elements:
        pid = el.get("id")
        if pid is None or pid not in eligible:
            continue
        s = el.get("stats") or {}
        if (s.get("minutes") or 0) == 0 and (s.get("total_points") or 0) == 0 \
           and (s.get("bps") or 0) == 0:
            continue

        c.execute("""
            INSERT INTO player_gameweek_history (
                player_id, gameweek, total_points, minutes,
                goals_scored, assists, clean_sheets, bonus, bps,
                ict_index, value, selected, transfers_in, transfers_out,
                expected_goals, expected_assists, expected_goal_involvements,
                expected_goals_conceded, saves, defensive_contribution,
                clearances_blocks_interceptions, recoveries, tackles,
                influence, creativity, threat,
                yellow_cards, red_cards, own_goals,
                penalties_saved, penalties_missed, season
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(player_id, gameweek) DO UPDATE SET
                season=EXCLUDED.season,
                total_points=EXCLUDED.total_points,
                minutes=EXCLUDED.minutes,
                goals_scored=EXCLUDED.goals_scored,
                assists=EXCLUDED.assists,
                clean_sheets=EXCLUDED.clean_sheets,
                bonus=EXCLUDED.bonus, bps=EXCLUDED.bps,
                ict_index=EXCLUDED.ict_index,
                expected_goals=EXCLUDED.expected_goals,
                expected_assists=EXCLUDED.expected_assists,
                expected_goal_involvements=EXCLUDED.expected_goal_involvements,
                expected_goals_conceded=EXCLUDED.expected_goals_conceded,
                saves=EXCLUDED.saves,
                defensive_contribution=EXCLUDED.defensive_contribution,
                clearances_blocks_interceptions=EXCLUDED.clearances_blocks_interceptions,
                recoveries=EXCLUDED.recoveries,
                tackles=EXCLUDED.tackles,
                influence=EXCLUDED.influence,
                creativity=EXCLUDED.creativity,
                threat=EXCLUDED.threat,
                yellow_cards=EXCLUDED.yellow_cards,
                red_cards=EXCLUDED.red_cards,
                own_goals=EXCLUDED.own_goals,
                penalties_saved=EXCLUDED.penalties_saved,
                penalties_missed=EXCLUDED.penalties_missed
        """, (
            pid, gw,
            int(s.get("total_points") or 0), int(s.get("minutes") or 0),
            int(s.get("goals_scored") or 0), int(s.get("assists") or 0),
            int(s.get("clean_sheets") or 0), int(s.get("bonus") or 0),
            int(s.get("bps") or 0),
            _f(s.get("ict_index")),
            eligible[pid], 0, 0, 0,
            _f(s.get("expected_goals")),
            _f(s.get("expected_assists")),
            _f(s.get("expected_goal_involvements")),
            _f(s.get("expected_goals_conceded")),
            int(s.get("saves") or 0),
            int(s.get("defensive_contribution") or 0),
            int(s.get("clearances_blocks_interceptions") or 0),
            int(s.get("recoveries") or 0),
            int(s.get("tackles") or 0),
            _f(s.get("influence")),
            _f(s.get("creativity")),
            _f(s.get("threat")),
            int(s.get("yellow_cards") or 0),
            int(s.get("red_cards") or 0),
            int(s.get("own_goals") or 0),
            int(s.get("penalties_saved") or 0),
            int(s.get("penalties_missed") or 0),
            season,
        ))
        touched += 1

    conn.commit()
    conn.close()
    print(f"✅ GW{gw}: synced live stats for {touched} players.")
    return touched


def sync_recent_events(num_recent: int = 3) -> int:
    """Refresh the most recent gameweeks (current + finished) using the bulk
    live endpoint. Cheap enough to run on every scheduler tick."""
    conn = get_conn()
    c = conn.cursor()
    c.execute("""
        SELECT id FROM gameweeks
        WHERE finished = 1 OR is_current = 1
        ORDER BY id DESC
        LIMIT %s
    """, (num_recent,))
    gw_ids = [row[0] for row in c.fetchall()]
    conn.close()

    if not gw_ids:
        print("ℹ️  No finished/current gameweeks yet (pre-season).")
        return 0

    total = 0
    for gw in gw_ids:
        total += sync_event_live(gw)
    print(f"✅ sync_recent_events: refreshed {len(gw_ids)} GW(s), {total} player-rows.")
    return total


def cleanup_blank_gameweeks() -> int:
    """Remove any player_gameweek_history row for a GW where the player's team
    had no fixture (a true blank). Idempotent."""
    conn = get_conn()
    c = conn.cursor()
    c.execute("""
        DELETE FROM player_gameweek_history h
        USING players p
        WHERE p.id = h.player_id
          AND NOT EXISTS (
              SELECT 1 FROM fixtures f
              WHERE f.gameweek = h.gameweek
                AND (f.team_h = p.team_id OR f.team_a = p.team_id)
          )
    """)
    deleted = c.rowcount or 0
    conn.commit()
    conn.close()
    if deleted:
        print(f"🧹 Removed {deleted} blank-GW history rows.")
    else:
        print("🧹 No blank-GW rows to clean.")
    return deleted


# --------------------------------------------------------------------------- #
# Projections (precomputed and stored so read endpoints stay fast)            #
# --------------------------------------------------------------------------- #

def sync_projections() -> int:
    """Run the projection algorithm once and store the result on each player, so
    the API can serve projections with a single fast SELECT instead of
    recomputing per request. Returns number of players projected."""
    from services.optimizer import compute_projections
    projections = compute_projections()  # [{id, projected_points}, ...]
    now = _now_iso()
    conn = get_conn()
    c = conn.cursor()
    # Reset first so players who dropped out of eligibility go back to NULL.
    c.execute("UPDATE players SET projected_points = NULL")
    for row in projections:
        c.execute(
            "UPDATE players SET projected_points=%s, projected_updated_at=%s WHERE id=%s",
            (row["projected_points"], now, row["id"]),
        )
    conn.commit()
    conn.close()
    print(f"✅ Stored projections for {len(projections)} players.")
    return len(projections)


# --------------------------------------------------------------------------- #
# Orchestration                                                                #
# --------------------------------------------------------------------------- #

def sync_light():
    """Fast, frequent sync — safe to run every couple of hours. Refreshes
    prices/form/xG (bootstrap), fixtures, the latest GW's live stats, and
    recomputes projections. Also keeps Supabase from auto-pausing."""
    init_db()
    sync_bootstrap()
    sync_fixtures()
    sync_recent_events(num_recent=2)
    cleanup_blank_gameweeks()
    sync_projections()
    print("🎉 Light sync complete!")


def sync_deep():
    """Heavier daily sync — full per-player history + last-season seeding +
    newcomer seeding, then projections."""
    init_db()
    sync_bootstrap()
    sync_fixtures()
    sync_player_histories(seed=True)
    sync_understat_newcomers()
    cleanup_blank_gameweeks()
    sync_projections()
    print("🎉 Deep sync complete!")


def full_sync():
    """Everything, from a cold/empty database. Use for the initial season seed."""
    sync_deep()


COMMANDS = {
    "migrate": init_db,
    "bootstrap": sync_bootstrap,
    "fixtures": sync_fixtures,
    "light": sync_light,
    "deep": sync_deep,
    "full": full_sync,
    "history": lambda: sync_player_histories(seed=True),
    "seed-newcomers": sync_understat_newcomers,
    "projections": sync_projections,
    "recent": lambda: sync_recent_events(3),
    "cleanup": cleanup_blank_gameweeks,
}


def main():
    parser = argparse.ArgumentParser(description="FPL data sync")
    parser.add_argument("command", nargs="?", default="full", choices=list(COMMANDS))
    args = parser.parse_args()
    if "DATABASE_URL" not in os.environ:
        print("❌ DATABASE_URL is not set.", file=sys.stderr)
        sys.exit(1)
    COMMANDS[args.command]()


if __name__ == "__main__":
    main()
