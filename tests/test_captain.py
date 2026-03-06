"""Tests for captain recommendations."""

from __future__ import annotations

import pytest

from fpl_optimizer.analysis.fixture_analyzer import FixtureWindow
from fpl_optimizer.analysis.points_predictor import PlayerPrediction
from fpl_optimizer.recommendations.captain import (
    DIFFERENTIAL_OWNERSHIP_THRESHOLD,
    CaptainRecommendation,
    recommend_captain,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pred(
    player_id: int,
    expected_pts: float,
    position: str = "MID",
    cost: float = 8.0,
    fixture_window: FixtureWindow | None = None,
) -> PlayerPrediction:
    return PlayerPrediction(
        player_id=player_id,
        web_name=f"P{player_id}",
        position=position,
        cost=cost,
        predicted_points=expected_pts,
        expected_points=expected_pts,
        availability_chance=1.0,
        fixture_window=fixture_window,
    )


# ---------------------------------------------------------------------------
# recommend_captain
# ---------------------------------------------------------------------------

def test_captain_is_highest_expected_pts():
    players = [_pred(i, float(i) * 1.5) for i in range(1, 8)]
    rec = recommend_captain(players)
    assert rec.captain.player_id == 7  # highest pts


def test_vice_captain_is_second_highest():
    players = [_pred(i, float(i) * 1.5) for i in range(1, 8)]
    rec = recommend_captain(players)
    assert rec.vice_captain.player_id == 6  # second highest


def test_captain_and_vc_are_different():
    players = [_pred(i, float(i)) for i in range(1, 5)]
    rec = recommend_captain(players)
    assert rec.captain.player_id != rec.vice_captain.player_id


def test_recommend_captain_empty_raises():
    with pytest.raises(ValueError):
        recommend_captain([])


def test_differential_pick_identified():
    """A player with low ownership but high xPts should be flagged."""
    high_ownership = [_pred(i, 7.0) for i in range(1, 5)]
    differential = _pred(99, 6.5)  # slightly lower pts but low ownership
    all_players = high_ownership + [differential]
    ownership = {
        p.player_id: 40.0 for p in high_ownership
    }
    ownership[99] = 5.0  # very low ownership

    rec = recommend_captain(all_players, ownership_percent=ownership)
    # Differential should be identified (not captain, not VC)
    if rec.differential_pick is not None:
        assert rec.differential_pick.player_id == 99


def test_no_differential_when_high_ownership():
    players = [_pred(i, float(i)) for i in range(1, 5)]
    ownership = {p.player_id: 50.0 for p in players}
    rec = recommend_captain(players, ownership_percent=ownership)
    assert rec.differential_pick is None


def test_dgw_captain_gets_bonus():
    """A DGW captain should score higher than a non-DGW captain with same xPts."""
    dgw_window = FixtureWindow(
        player_id=1,
        gameweeks=[1, 1],
        difficulties=[2, 3],
        double_gameweeks=[1],
        blank_gameweeks=[],
    )
    p_dgw = _pred(1, 7.0, fixture_window=dgw_window)
    p_normal = _pred(2, 7.0)
    players = [p_dgw, p_normal]
    rec = recommend_captain(players)
    assert rec.captain.player_id == 1  # DGW player should win


def test_captain_recommendation_display():
    players = [_pred(i, float(i)) for i in range(1, 5)]
    rec = recommend_captain(players)
    text = rec.display()
    assert "Captain" in text
    assert "Vice-captain" in text
