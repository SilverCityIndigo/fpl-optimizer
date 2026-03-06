"""Tests for the fixture difficulty analyser."""

from __future__ import annotations

import pytest

from fpl_optimizer.analysis.fixture_analyzer import (
    FixtureWindow,
    analyse_fixtures,
    build_fixture_map,
    rank_by_fixtures,
)
from fpl_optimizer.models.player import Fixture, Player


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_player(player_id: int = 1, team_id: int = 1) -> Player:
    return Player(
        id=player_id,
        first_name="Test",
        second_name="Player",
        web_name="TPlayer",
        team_id=team_id,
        position_id=3,
        now_cost=80,
        total_points=100,
        form=5.0,
        points_per_game=5.0,
        selected_by_percent=10.0,
        status="a",
        chance_of_playing_next_round=None,
        minutes=900,
        goals_scored=5,
        assists=3,
        clean_sheets=2,
        goals_conceded=10,
        yellow_cards=1,
        red_cards=0,
        saves=0,
        bonus=8,
        bps=200,
        influence=100.0,
        creativity=80.0,
        threat=120.0,
        ict_index=300.0,
        expected_goals=4.0,
        expected_assists=3.0,
        expected_goal_involvements=7.0,
        expected_goals_conceded=0.0,
        transfers_in_event=10000,
        transfers_out_event=5000,
    )


def _make_fixture(
    fixture_id: int,
    gw: int,
    home_team: int,
    away_team: int,
    home_diff: int = 3,
    away_diff: int = 3,
) -> Fixture:
    return Fixture(
        id=fixture_id,
        gameweek=gw,
        home_team_id=home_team,
        away_team_id=away_team,
        home_team_difficulty=home_diff,
        away_team_difficulty=away_diff,
        finished=False,
        home_team_score=None,
        away_team_score=None,
    )


# ---------------------------------------------------------------------------
# build_fixture_map
# ---------------------------------------------------------------------------

def test_build_fixture_map_includes_home_and_away():
    fixtures = [
        _make_fixture(1, gw=1, home_team=1, away_team=2),
        _make_fixture(2, gw=2, home_team=3, away_team=1),
        _make_fixture(3, gw=3, home_team=4, away_team=5),  # team 1 not involved
    ]
    gw_map = build_fixture_map(fixtures, team_id=1, start_gw=1, num_gws=3)
    assert len(gw_map[1]) == 1
    assert len(gw_map[2]) == 1
    assert len(gw_map[3]) == 0


def test_build_fixture_map_double_gw():
    fixtures = [
        _make_fixture(1, gw=5, home_team=1, away_team=2),
        _make_fixture(2, gw=5, home_team=3, away_team=1),
    ]
    gw_map = build_fixture_map(fixtures, team_id=1, start_gw=5, num_gws=1)
    assert len(gw_map[5]) == 2


def test_build_fixture_map_excludes_out_of_range():
    fixtures = [_make_fixture(1, gw=10, home_team=1, away_team=2)]
    gw_map = build_fixture_map(fixtures, team_id=1, start_gw=1, num_gws=3)
    for gw in range(1, 4):
        assert len(gw_map[gw]) == 0


# ---------------------------------------------------------------------------
# analyse_fixtures
# ---------------------------------------------------------------------------

def test_analyse_fixtures_home_difficulty():
    player = _make_player(team_id=1)
    fixtures = [_make_fixture(1, gw=1, home_team=1, away_team=2, home_diff=2)]
    fw = analyse_fixtures(player, fixtures, start_gw=1, num_gws=1)
    assert fw.difficulties == [2]
    assert fw.gameweeks == [1]


def test_analyse_fixtures_away_difficulty():
    player = _make_player(team_id=2)
    fixtures = [_make_fixture(1, gw=1, home_team=1, away_team=2, away_diff=4)]
    fw = analyse_fixtures(player, fixtures, start_gw=1, num_gws=1)
    assert fw.difficulties == [4]


def test_analyse_fixtures_blank_gameweek():
    player = _make_player(team_id=1)
    fixtures = []  # no fixtures at all
    fw = analyse_fixtures(player, fixtures, start_gw=1, num_gws=2)
    assert fw.blank_gameweeks == [1, 2]
    assert fw.difficulties == []


def test_analyse_fixtures_double_gameweek():
    player = _make_player(team_id=1)
    fixtures = [
        _make_fixture(1, gw=3, home_team=1, away_team=2, home_diff=2),
        _make_fixture(2, gw=3, home_team=3, away_team=1, away_diff=3),
    ]
    fw = analyse_fixtures(player, fixtures, start_gw=3, num_gws=1)
    assert 3 in fw.double_gameweeks
    assert len(fw.difficulties) == 2


# ---------------------------------------------------------------------------
# FixtureWindow computed properties
# ---------------------------------------------------------------------------

def test_fixture_window_average_difficulty():
    fw = FixtureWindow(
        player_id=1,
        gameweeks=[1, 2, 3],
        difficulties=[2, 3, 4],
        double_gameweeks=[],
        blank_gameweeks=[],
    )
    assert abs(fw.average_difficulty - 3.0) < 0.001


def test_fixture_window_empty_average():
    fw = FixtureWindow(
        player_id=1,
        gameweeks=[],
        difficulties=[],
        double_gameweeks=[],
        blank_gameweeks=[1],
    )
    assert fw.average_difficulty == 3.0


def test_fixture_window_score_easy_fixtures():
    easy_fw = FixtureWindow(
        player_id=1,
        gameweeks=[1, 2, 3, 4, 5],
        difficulties=[1, 1, 1, 1, 1],
        double_gameweeks=[],
        blank_gameweeks=[],
    )
    hard_fw = FixtureWindow(
        player_id=2,
        gameweeks=[1, 2, 3, 4, 5],
        difficulties=[5, 5, 5, 5, 5],
        double_gameweeks=[],
        blank_gameweeks=[],
    )
    assert easy_fw.fixture_score > hard_fw.fixture_score


def test_fixture_window_dgw_bonus():
    plain_fw = FixtureWindow(
        player_id=1,
        gameweeks=[1, 2],
        difficulties=[3, 3],
        double_gameweeks=[],
        blank_gameweeks=[],
    )
    dgw_fw = FixtureWindow(
        player_id=2,
        gameweeks=[1, 2],
        difficulties=[3, 3],
        double_gameweeks=[1],
        blank_gameweeks=[],
    )
    assert dgw_fw.fixture_score > plain_fw.fixture_score


# ---------------------------------------------------------------------------
# rank_by_fixtures
# ---------------------------------------------------------------------------

def test_rank_by_fixtures_ordering():
    p1 = _make_player(player_id=1, team_id=1)
    p2 = _make_player(player_id=2, team_id=2)
    fixtures = [
        _make_fixture(1, gw=1, home_team=1, away_team=3, home_diff=1),  # easy for p1
        _make_fixture(2, gw=1, home_team=2, away_team=4, home_diff=5),  # hard for p2
    ]
    ranked = rank_by_fixtures([p1, p2], fixtures, start_gw=1, num_gws=1)
    assert ranked[0][0].id == 1  # p1 should rank higher (easier fixture)
