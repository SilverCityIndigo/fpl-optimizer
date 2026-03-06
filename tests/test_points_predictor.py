"""Tests for the points predictor."""

from __future__ import annotations

import pytest

from fpl_optimizer.analysis.fixture_analyzer import FixtureWindow
from fpl_optimizer.analysis.points_predictor import (
    PlayerPrediction,
    _availability_chance,
    _base_points_from_stats,
    predict_player,
    predict_all,
)
from fpl_optimizer.models.player import Player


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_player(
    player_id: int = 1,
    position_id: int = 3,  # MID
    status: str = "a",
    chance: int | None = None,
    goals: int = 10,
    assists: int = 5,
    clean_sheets: int = 3,
    goals_conceded: int = 20,
    saves: int = 0,
    bonus: int = 15,
    bps: int = 300,
    minutes: int = 900,
    form: float = 6.0,
    ppg: float = 5.5,
    ict: float = 120.0,
    xg: float = 8.0,
    xa: float = 4.0,
    now_cost: int = 85,
) -> Player:
    return Player(
        id=player_id,
        first_name="Test",
        second_name="Player",
        web_name="TPlayer",
        team_id=1,
        position_id=position_id,
        now_cost=now_cost,
        total_points=120,
        form=form,
        points_per_game=ppg,
        selected_by_percent=15.0,
        status=status,
        chance_of_playing_next_round=chance,
        minutes=minutes,
        goals_scored=goals,
        assists=assists,
        clean_sheets=clean_sheets,
        goals_conceded=goals_conceded,
        yellow_cards=1,
        red_cards=0,
        saves=saves,
        bonus=bonus,
        bps=bps,
        influence=100.0,
        creativity=80.0,
        threat=100.0,
        ict_index=ict,
        expected_goals=xg,
        expected_assists=xa,
        expected_goal_involvements=xg + xa,
        expected_goals_conceded=0.0,
        transfers_in_event=5000,
        transfers_out_event=1000,
    )


def _make_fixture_window(
    player_id: int = 1,
    difficulties: list[int] | None = None,
    double_gameweeks: list[int] | None = None,
    blank_gameweeks: list[int] | None = None,
) -> FixtureWindow:
    difficulties = difficulties or [3]
    gws = list(range(1, len(difficulties) + 1))
    return FixtureWindow(
        player_id=player_id,
        gameweeks=gws,
        difficulties=difficulties,
        double_gameweeks=double_gameweeks or [],
        blank_gameweeks=blank_gameweeks or [],
    )


# ---------------------------------------------------------------------------
# _availability_chance
# ---------------------------------------------------------------------------

def test_availability_available():
    p = _make_player(status="a")
    assert _availability_chance(p) == 1.0


def test_availability_injured():
    p = _make_player(status="i")
    assert _availability_chance(p) == 0.0


def test_availability_suspended():
    p = _make_player(status="s")
    assert _availability_chance(p) == 0.0


def test_availability_doubtful_no_chance():
    p = _make_player(status="d", chance=None)
    assert _availability_chance(p) == 0.5


def test_availability_explicit_chance():
    p = _make_player(status="d", chance=75)
    assert _availability_chance(p) == 0.75


# ---------------------------------------------------------------------------
# _base_points_from_stats
# ---------------------------------------------------------------------------

def test_base_points_forward():
    p = _make_player(position_id=4, goals=15, assists=8, clean_sheets=0)
    pts = _base_points_from_stats(p, games_played=30)
    # 2 (playing) + (15/30)*4 (goals) + (8/30)*3 (assists) + bonus
    assert pts > 4.0  # sanity check


def test_base_points_goalkeeper():
    p = _make_player(position_id=1, saves=90, clean_sheets=15, goals_conceded=20)
    pts = _base_points_from_stats(p, games_played=30)
    # GKP should score more from clean sheets + saves
    assert pts > 5.0


def test_base_points_zero_games():
    p = _make_player()
    pts = _base_points_from_stats(p, games_played=0)
    assert pts == 0.0


def test_base_points_non_negative():
    # A player with lots of goals conceded shouldn't produce negative base points
    p = _make_player(position_id=2, goals=0, assists=0, clean_sheets=0, goals_conceded=100)
    pts = _base_points_from_stats(p, games_played=30)
    assert pts >= 0.0


# ---------------------------------------------------------------------------
# predict_player
# ---------------------------------------------------------------------------

def test_predict_player_returns_prediction():
    p = _make_player()
    pred = predict_player(p)
    assert isinstance(pred, PlayerPrediction)
    assert pred.player_id == p.id
    assert pred.predicted_points >= 0


def test_predict_player_injured_reduces_expected():
    available = _make_player(status="a")
    injured = _make_player(status="i")
    pred_a = predict_player(available)
    pred_i = predict_player(injured)
    assert pred_i.expected_points < pred_a.expected_points
    assert pred_i.expected_points == 0.0


def test_predict_player_easy_fixture_higher_than_hard():
    p = _make_player()
    easy_fw = _make_fixture_window(difficulties=[1])
    hard_fw = _make_fixture_window(difficulties=[5])
    easy_pred = predict_player(p, fixture_window=easy_fw)
    hard_pred = predict_player(p, fixture_window=hard_fw)
    assert easy_pred.predicted_points > hard_pred.predicted_points


def test_predict_player_points_per_million():
    p = _make_player(now_cost=100)  # £10.0m
    pred = predict_player(p)
    assert pred.points_per_million == pred.expected_points / 10.0


def test_predict_player_display_string():
    p = _make_player()
    pred = predict_player(p)
    text = pred.display()
    assert "TPlayer" in text
    assert "MID" in text


# ---------------------------------------------------------------------------
# predict_all
# ---------------------------------------------------------------------------

def test_predict_all_sorted_descending():
    players = [_make_player(player_id=i, form=float(i)) for i in range(1, 6)]
    preds = predict_all(players)
    for i in range(len(preds) - 1):
        assert preds[i].expected_points >= preds[i + 1].expected_points


def test_predict_all_with_fixture_windows():
    players = [_make_player(player_id=1), _make_player(player_id=2)]
    fws = {
        1: _make_fixture_window(player_id=1, difficulties=[1]),
        2: _make_fixture_window(player_id=2, difficulties=[5]),
    }
    preds = predict_all(players, fixture_windows=fws)
    # Player 1 has easier fixture – should rank higher
    assert preds[0].player_id == 1
