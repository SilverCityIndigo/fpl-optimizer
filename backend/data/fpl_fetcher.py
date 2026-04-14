"""
FPL Data Fetcher — Postgres/Supabase version
"""

import os
import requests
import psycopg2
from datetime import datetime
from rapidfuzz import process, fuzz
from understatapi import UnderstatClient

BASE_URL = "https://fantasy.premierleague.com/api"
UNDERSTAT_SEASON = "2025"
HEADERS = {"User-Agent": "Mozilla/5.0"}


def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


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


def init_db():
    # Schema is created directly in Supabase — this is a no-op now.
    print("✅ Database schema managed via Supabase.")


POSITION_MAP = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}


def sync_bootstrap():
    print("📡 Fetching bootstrap data...")
    data = get_bootstrap()
    conn = get_conn()
    c = conn.cursor()
    now = datetime.utcnow().isoformat()

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
        c.execute("""
            INSERT INTO players (
                id, code, web_name, full_name, team_id, position, price,
                total_points, points_per_game, form, selected_by_percent,
                minutes, goals_scored, assists, clean_sheets, bonus,
                ict_index, news, chance_of_playing_next_round, status,
                transfers_in_event, transfers_out_event,
                xg_per90, xa_per90, xgi_per90, updated_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0.0,0.0,0.0,%s)
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
                updated_at=EXCLUDED.updated_at
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
            p["minutes"], p["goals_scored"], p["assists"], p["clean_sheets"],
            p["bonus"], float(p["ict_index"] or 0),
            p.get("news", ""), p.get("chance_of_playing_next_round"),
            p["status"],
            p.get("transfers_in_event", 0), p.get("transfers_out_event", 0),
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

    conn.commit()
    conn.close()
    print(f"✅ Synced {len(data['elements'])} players, {len(data['teams'])} teams.")


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
    conn.commit()
    conn.close()
    print(f"✅ Synced {len(fixtures)} fixtures.")


def sync_player_histories(limit: int = None):
    conn = get_conn()
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
            conn = get_conn()
            c = conn.cursor()
            for gw in data["history"]:
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
                        penalties_saved, penalties_missed
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT(player_id, gameweek) DO UPDATE SET
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
                        influence=EXCLUDED.influence,
                        creativity=EXCLUDED.creativity,
                        threat=EXCLUDED.threat,
                        yellow_cards=EXCLUDED.yellow_cards,
                        red_cards=EXCLUDED.red_cards
                """, (
                    pid, gw["round"], gw["total_points"], gw["minutes"],
                    gw["goals_scored"], gw["assists"], gw["clean_sheets"],
                    gw["bonus"], gw["bps"],
                    float(gw["ict_index"] or 0),
                    gw["value"] / 10.0, gw["selected"],
                    gw["transfers_in"], gw["transfers_out"],
                    float(gw.get("expected_goals") or 0),
                    float(gw.get("expected_assists") or 0),
                    float(gw.get("expected_goal_involvements") or 0),
                    float(gw.get("expected_goals_conceded") or 0),
                    int(gw.get("saves") or 0),
                    int(gw.get("defensive_contribution") or 0),
                    int(gw.get("clearances_blocks_interceptions") or 0),
                    int(gw.get("recoveries") or 0),
                    int(gw.get("tackles") or 0),
                    float(gw.get("influence") or 0),
                    float(gw.get("creativity") or 0),
                    float(gw.get("threat") or 0),
                    int(gw.get("yellow_cards") or 0),
                    int(gw.get("red_cards") or 0),
                    int(gw.get("own_goals") or 0),
                    int(gw.get("penalties_saved") or 0),
                    int(gw.get("penalties_missed") or 0),
                ))
            conn.commit()
            conn.close()
            if (i + 1) % 50 == 0:
                print(f"  ... {i+1}/{len(player_ids)}")
        except Exception as e:
            print(f"  ⚠️  Failed for player {pid}: {e}")

    print("✅ Player histories synced.")


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
                xg = float(p.get("xG", 0) or 0)
                xa = float(p.get("xA", 0) or 0)
                xg_data[p["player_name"]] = {
                    "xg_per90":  round(xg / nineties, 3),
                    "xa_per90":  round(xa / nineties, 3),
                    "xgi_per90": round((xg + xa) / nineties, 3),
                    "minutes":   int(minutes),
                }
            except (ValueError, TypeError, KeyError):
                continue
        print(f"✅ Understat: got xG data for {len(xg_data)} players")
    except Exception as e:
        print(f"⚠️  Understat fetch failed: {e}.")
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
            result = process.extractOne(query, understat_names,
                scorer=fuzz.token_sort_ratio, score_cutoff=78)
            if result and result[1] > best_score:
                best_match = result
                best_score = result[1]
        if best_match:
            matched[fpl_id] = {**xg_data[best_match[0]]}
        else:
            unmatched.append(full_name)
    print(f"✅ Fuzzy matched {len(matched)}/{len(fpl_players)} players to Understat")
    if unmatched[:5]:
        print(f"   Unmatched examples: {unmatched[:5]}")
    return matched


def sync_xg():
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT id, full_name, web_name FROM players")
    fpl_players = c.fetchall()
    conn.close()
    xg_data = fetch_understat_xg()
    if not xg_data:
        print("⚠️  No xG data — skipping.")
        return
    matched = fuzzy_match_xg(fpl_players, xg_data)
    if not matched:
        print("⚠️  No matches — skipping.")
        return
    conn = get_conn()
    c = conn.cursor()
    for fpl_id, stats in matched.items():
        c.execute("""
            UPDATE players SET xg_per90=%s, xa_per90=%s, xgi_per90=%s WHERE id=%s
        """, (stats["xg_per90"], stats["xa_per90"], stats["xgi_per90"], fpl_id))
    conn.commit()
    conn.close()
    print(f"✅ xG data stored for {len(matched)} players.")


def full_sync():
    init_db()
    sync_bootstrap()
    sync_fixtures()
    sync_player_histories()
    sync_xg()
    print("🎉 Full sync complete!")


if __name__ == "__main__":
    full_sync()