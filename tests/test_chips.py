"""Tests for the chip advisor."""

from __future__ import annotations

import pytest

from fpl_optimizer.analysis.fixture_analyzer import FixtureWindow
from fpl_optimizer.analysis.points_predictor import PlayerPrediction
from fpl_optimizer.recommendations.chips import (
    ChipAdvice,
    ChipRecommendation,
    advise_chips,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pred(
    player_id: int,
    expected_pts: float,
    position: str = "MID",
    fixture_window: FixtureWindow | None = None,
) -> PlayerPrediction:
    return PlayerPrediction(
        player_id=player_id,
        web_name=f"P{player_id}",
        position=position,
        cost=7.0,
        predicted_points=expected_pts,
        expected_points=expected_pts,
        availability_chance=1.0,
        fixture_window=fixture_window,
    )


def _dgw_window(player_id: int, gw: int = 1) -> FixtureWindow:
    return FixtureWindow(
        player_id=player_id,
        gameweeks=[gw, gw],
        difficulties=[2, 3],
        double_gameweeks=[gw],
        blank_gameweeks=[],
    )


def _blank_window(player_id: int, gw: int = 1) -> FixtureWindow:
    return FixtureWindow(
        player_id=player_id,
        gameweeks=[],
        difficulties=[],
        double_gameweeks=[],
        blank_gameweeks=[gw],
    )


# ---------------------------------------------------------------------------
# advise_chips
# ---------------------------------------------------------------------------

def test_chip_advice_returns_all_four_chips():
    xi = [_pred(i, 5.0) for i in range(1, 12)]
    bench = [_pred(i, 3.0) for i in range(12, 16)]
    captain = xi[0]
    advice = advise_chips(gameweek=1, starting_xi=xi, bench=bench, captain=captain)
    chip_names = {r.chip for r in advice.recommendations}
    assert "triple_captain" in chip_names
    assert "bench_boost" in chip_names
    assert "free_hit" in chip_names
    assert "wildcard" in chip_names


def test_already_used_chips_not_recommended():
    xi = [_pred(i, 5.0) for i in range(1, 12)]
    bench = [_pred(i, 3.0) for i in range(12, 16)]
    captain = xi[0]
    used = {"triple_captain", "bench_boost", "free_hit", "wildcard"}
    advice = advise_chips(
        gameweek=1, starting_xi=xi, bench=bench, captain=captain, chips_used=used
    )
    for rec in advice.recommendations:
        assert not rec.recommended
        assert rec.readiness_score == 0


def test_triple_captain_recommended_in_dgw_with_high_xpts():
    dgw_fw = _dgw_window(player_id=1, gw=5)
    captain = _pred(1, 12.0, fixture_window=dgw_fw)  # high xPts
    xi = [captain] + [_pred(i, 5.0) for i in range(2, 12)]
    bench = [_pred(i, 3.0) for i in range(12, 16)]
    advice = advise_chips(gameweek=5, starting_xi=xi, bench=bench, captain=captain)
    tc_rec = next(r for r in advice.recommendations if r.chip == "triple_captain")
    assert tc_rec.recommended is True


def test_free_hit_recommended_for_high_blank_ratio():
    blank_fw = _blank_window(player_id=0, gw=1)
    # Create 11 players, most with a blank this GW
    xi = [_pred(i, 4.0, fixture_window=blank_fw) for i in range(1, 9)]  # 8 blanks
    xi += [_pred(i, 4.0) for i in range(9, 12)]  # 3 normal
    bench = [_pred(i, 3.0) for i in range(12, 16)]
    captain = xi[0]
    advice = advise_chips(gameweek=1, starting_xi=xi, bench=bench, captain=captain)
    fh_rec = next(r for r in advice.recommendations if r.chip == "free_hit")
    assert fh_rec.recommended is True


def test_wildcard_recommended_with_many_injuries():
    xi = [_pred(i, 5.0) for i in range(1, 12)]
    bench = [_pred(i, 3.0) for i in range(12, 16)]
    captain = xi[0]
    advice = advise_chips(
        gameweek=1,
        starting_xi=xi,
        bench=bench,
        captain=captain,
        squad_injury_count=4,
    )
    wc_rec = next(r for r in advice.recommendations if r.chip == "wildcard")
    assert wc_rec.recommended is True


def test_bench_boost_recommended_dgw_good_bench():
    dgw_fw = _dgw_window(player_id=0, gw=3)
    xi = [_pred(i, 5.0, fixture_window=dgw_fw) for i in range(1, 12)]
    # Good bench with DGW coverage
    bench = [_pred(i, 5.0, fixture_window=dgw_fw) for i in range(12, 16)]
    captain = xi[0]
    advice = advise_chips(gameweek=3, starting_xi=xi, bench=bench, captain=captain)
    bb_rec = next(r for r in advice.recommendations if r.chip == "bench_boost")
    assert bb_rec.recommended is True


def test_chip_advice_display_contains_all_chips():
    xi = [_pred(i, 5.0) for i in range(1, 12)]
    bench = [_pred(i, 3.0) for i in range(12, 16)]
    captain = xi[0]
    advice = advise_chips(gameweek=10, starting_xi=xi, bench=bench, captain=captain)
    text = advice.display()
    assert "GW10" in text
    assert "TRIPLE_CAPTAIN" in text
    assert "BENCH_BOOST" in text
    assert "FREE_HIT" in text
    assert "WILDCARD" in text
