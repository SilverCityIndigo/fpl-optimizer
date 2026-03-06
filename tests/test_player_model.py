"""Tests for Player and Team data models."""

from __future__ import annotations

import pytest

from fpl_optimizer.models.player import (
    Fixture,
    GameweekStats,
    Player,
    Team,
    POSITION_ID,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _player_data(**overrides) -> dict:
    base = {
        "id": 1,
        "first_name": "Mohamed",
        "second_name": "Salah",
        "web_name": "Salah",
        "team": 11,
        "element_type": 3,  # MID
        "now_cost": 130,
        "total_points": 180,
        "form": "8.2",
        "points_per_game": "7.5",
        "selected_by_percent": "45.0",
        "status": "a",
        "chance_of_playing_next_round": None,
        "minutes": 2700,
        "goals_scored": 18,
        "assists": 10,
        "clean_sheets": 5,
        "goals_conceded": 20,
        "yellow_cards": 2,
        "red_cards": 0,
        "saves": 0,
        "bonus": 30,
        "bps": 650,
        "influence": "800.0",
        "creativity": "700.0",
        "threat": "900.0",
        "ict_index": "200.0",
        "expected_goals": "15.5",
        "expected_assists": "9.2",
        "expected_goal_involvements": "24.7",
        "expected_goals_conceded": "0.0",
        "transfers_in_event": 100_000,
        "transfers_out_event": 20_000,
    }
    base.update(overrides)
    return base


def _make_player(**overrides) -> Player:
    return Player.from_api(_player_data(**overrides))


# ---------------------------------------------------------------------------
# Team
# ---------------------------------------------------------------------------

def test_team_from_api():
    data = {"id": 11, "name": "Liverpool", "short_name": "LIV", "strength": 5}
    team = Team.from_api(data)
    assert team.id == 11
    assert team.name == "Liverpool"
    assert team.short_name == "LIV"
    assert team.strength == 5


def test_team_defaults_strength():
    data = {"id": 1, "name": "Test", "short_name": "TST"}
    team = Team.from_api(data)
    assert team.strength == 3


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

def test_fixture_from_api():
    data = {
        "id": 10,
        "event": 5,
        "team_h": 1,
        "team_a": 2,
        "team_h_difficulty": 2,
        "team_a_difficulty": 4,
        "finished": False,
        "team_h_score": None,
        "team_a_score": None,
    }
    f = Fixture.from_api(data)
    assert f.id == 10
    assert f.gameweek == 5
    assert f.home_team_id == 1
    assert f.away_team_id == 2
    assert f.home_team_difficulty == 2
    assert f.away_team_difficulty == 4
    assert not f.finished


def test_fixture_no_event():
    data = {
        "id": 99,
        "event": None,
        "team_h": 5,
        "team_a": 6,
        "team_h_difficulty": 3,
        "team_a_difficulty": 3,
        "finished": False,
        "team_h_score": None,
        "team_a_score": None,
    }
    f = Fixture.from_api(data)
    assert f.gameweek is None


# ---------------------------------------------------------------------------
# Player
# ---------------------------------------------------------------------------

def test_player_from_api_basic():
    p = _make_player()
    assert p.id == 1
    assert p.web_name == "Salah"
    assert p.position_id == 3
    assert p.position == "MID"
    assert p.cost == 13.0
    assert p.total_points == 180
    assert p.form == 8.2
    assert p.minutes == 2700


def test_player_position_mapping():
    for pos_id, pos_name in POSITION_ID.items():
        p = _make_player(element_type=pos_id)
        assert p.position == pos_name


def test_player_is_available_status_a():
    p = _make_player(status="a")
    assert p.is_available is True


def test_player_is_not_available_injured():
    p = _make_player(status="i")
    assert p.is_available is False


def test_player_is_not_available_suspended():
    p = _make_player(status="s")
    assert p.is_available is False


def test_player_is_not_available_unavailable():
    p = _make_player(status="u")
    assert p.is_available is False


def test_player_doubtful_zero_chance():
    p = _make_player(status="d", chance_of_playing_next_round=0)
    assert p.is_available is False


def test_player_doubtful_fifty_chance():
    p = _make_player(status="d", chance_of_playing_next_round=50)
    assert p.is_available is True


def test_player_display_contains_key_info():
    p = _make_player()
    text = p.display()
    assert "Salah" in text
    assert "MID" in text
    assert "£13.0m" in text
    assert "180pts" in text


def test_player_xg_parsed_from_string():
    p = _make_player(expected_goals="12.34")
    assert abs(p.expected_goals - 12.34) < 0.001


def test_player_xg_handles_none():
    p = _make_player(expected_goals=None)
    assert p.expected_goals == 0.0


# ---------------------------------------------------------------------------
# GameweekStats
# ---------------------------------------------------------------------------

def test_gameweek_stats_from_api():
    data = {
        "round": 7,
        "total_points": 12,
        "minutes": 90,
        "goals_scored": 2,
        "assists": 1,
        "clean_sheets": 0,
        "goals_conceded": 2,
        "yellow_cards": 0,
        "red_cards": 0,
        "saves": 0,
        "bonus": 3,
        "bps": 55,
        "selected": 1_500_000,
        "transfers_in": 50_000,
        "transfers_out": 10_000,
        "value": 130,
    }
    gws = GameweekStats.from_api(data)
    assert gws.gameweek == 7
    assert gws.total_points == 12
    assert gws.goals_scored == 2
    assert gws.assists == 1
    assert gws.bonus == 3
