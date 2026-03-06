"""Tests for the squad optimizer."""

from __future__ import annotations

import pytest

from fpl_optimizer.analysis.points_predictor import PlayerPrediction
from fpl_optimizer.optimizer.squad_optimizer import (
    BUDGET,
    GKP_COUNT,
    DEF_COUNT,
    MID_COUNT,
    FWD_COUNT,
    STARTING_XI,
    OptimizedSquad,
    TransferPlan,
    optimize_squad,
    suggest_transfers,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pred(
    player_id: int,
    position: str,
    expected_pts: float,
    cost: float,
    team_id: int = 1,
) -> PlayerPrediction:
    return PlayerPrediction(
        player_id=player_id,
        web_name=f"P{player_id}",
        position=position,
        cost=cost,
        predicted_points=expected_pts,
        expected_points=expected_pts,
        availability_chance=1.0,
    )


def _build_pool(
    n_gkp: int = 5,
    n_def: int = 10,
    n_mid: int = 10,
    n_fwd: int = 8,
    base_pts: float = 5.0,
    cost: float = 6.0,
) -> tuple[list[PlayerPrediction], dict[int, int], dict[int, int]]:
    """Create a pool of players large enough for the optimizer."""
    players: list[PlayerPrediction] = []
    player_costs: dict[int, int] = {}
    player_team_ids: dict[int, int] = {}
    pid = 1

    for i, (pos, count) in enumerate(
        [("GKP", n_gkp), ("DEF", n_def), ("MID", n_mid), ("FWD", n_fwd)]
    ):
        for j in range(count):
            # Spread across different clubs to avoid 3-per-club violations
            team_id = (pid % 20) + 1
            pts = base_pts + pid * 0.01  # slight variation
            p = _pred(pid, pos, pts, cost, team_id)
            players.append(p)
            player_costs[pid] = round(cost * 10)
            player_team_ids[pid] = team_id
            pid += 1

    return players, player_costs, player_team_ids


# ---------------------------------------------------------------------------
# optimize_squad
# ---------------------------------------------------------------------------

def test_optimize_squad_returns_15_players():
    players, costs, teams = _build_pool()
    result = optimize_squad(players, player_costs=costs, player_team_ids=teams)
    assert len(result.squad) == 15


def test_optimize_squad_starting_xi_is_11():
    players, costs, teams = _build_pool()
    result = optimize_squad(players, player_costs=costs, player_team_ids=teams)
    assert len(result.starting_xi) == STARTING_XI


def test_optimize_squad_bench_is_4():
    players, costs, teams = _build_pool()
    result = optimize_squad(players, player_costs=costs, player_team_ids=teams)
    assert len(result.bench) == 4


def test_optimize_squad_position_counts():
    players, costs, teams = _build_pool()
    result = optimize_squad(players, player_costs=costs, player_team_ids=teams)

    gkp = [p for p in result.squad if p.position == "GKP"]
    defs = [p for p in result.squad if p.position == "DEF"]
    mids = [p for p in result.squad if p.position == "MID"]
    fwds = [p for p in result.squad if p.position == "FWD"]

    assert len(gkp) == GKP_COUNT
    assert len(defs) == DEF_COUNT
    assert len(mids) == MID_COUNT
    assert len(fwds) == FWD_COUNT


def test_optimize_squad_budget_respected():
    players, costs, teams = _build_pool(cost=6.0)  # 6.0m per player
    result = optimize_squad(players, budget=BUDGET, player_costs=costs, player_team_ids=teams)
    assert result.total_cost <= BUDGET / 10.0


def test_optimize_squad_captain_in_starting_xi():
    players, costs, teams = _build_pool()
    result = optimize_squad(players, player_costs=costs, player_team_ids=teams)
    xi_ids = {p.player_id for p in result.starting_xi}
    assert result.captain.player_id in xi_ids


def test_optimize_squad_vice_captain_in_starting_xi():
    players, costs, teams = _build_pool()
    result = optimize_squad(players, player_costs=costs, player_team_ids=teams)
    xi_ids = {p.player_id for p in result.starting_xi}
    assert result.vice_captain.player_id in xi_ids


def test_optimize_squad_starting_xi_has_valid_formation():
    players, costs, teams = _build_pool()
    result = optimize_squad(players, player_costs=costs, player_team_ids=teams)

    gkp_xi = [p for p in result.starting_xi if p.position == "GKP"]
    def_xi = [p for p in result.starting_xi if p.position == "DEF"]
    mid_xi = [p for p in result.starting_xi if p.position == "MID"]
    fwd_xi = [p for p in result.starting_xi if p.position == "FWD"]

    assert len(gkp_xi) == 1
    assert len(def_xi) >= 3
    assert len(mid_xi) >= 2
    assert len(fwd_xi) >= 1


def test_optimize_squad_max_3_per_club():
    """Ensure at most 3 players from any single club are selected."""
    players, costs, teams = _build_pool()
    result = optimize_squad(players, player_costs=costs, player_team_ids=teams)

    team_count: dict[int, int] = {}
    for p in result.squad:
        tid = teams.get(p.player_id, 0)
        team_count[tid] = team_count.get(tid, 0) + 1
    assert max(team_count.values()) <= 3


def test_optimize_squad_display_contains_key_sections():
    players, costs, teams = _build_pool()
    result = optimize_squad(players, player_costs=costs, player_team_ids=teams)
    text = result.display()
    assert "OPTIMIZED SQUAD" in text
    assert "GKP" in text
    assert "BENCH" in text
    assert "[C]" in text


# ---------------------------------------------------------------------------
# suggest_transfers
# ---------------------------------------------------------------------------

def test_suggest_transfers_finds_improvements():
    positions = (
        ["GKP"] * 2
        + ["DEF"] * 5
        + ["MID"] * 5
        + ["FWD"] * 3
    )
    current_squad = [
        _pred(pid, pos, 3.0, 6.0)
        for pid, pos in enumerate(positions, start=1)
    ]

    # Add high-value replacements not in squad
    better_players = [
        _pred(100, "GKP", 7.0, 6.0),
        _pred(101, "DEF", 8.0, 6.0),
        _pred(102, "MID", 9.0, 6.0),
    ]
    all_preds = current_squad + better_players

    plan = suggest_transfers(
        current_squad=current_squad,
        all_predictions=all_preds,
        free_transfers=1,
    )
    assert isinstance(plan, TransferPlan)
    # Should find at least one improvement
    assert len(plan.transfers) >= 1
    assert plan.transfers[0].points_gain > 0


def test_suggest_transfers_no_improvements():
    """When squad is already optimal no transfers should be suggested."""
    positions = ["GKP"] * 2 + ["DEF"] * 5 + ["MID"] * 5 + ["FWD"] * 3
    current_squad = [_pred(i, pos, 9.0, 6.0) for i, pos in enumerate(positions, start=1)]
    # Only same-quality but more expensive replacements
    replacements = [
        _pred(101, "GKP", 9.0, 7.0),
        _pred(102, "DEF", 9.0, 7.0),
        _pred(103, "MID", 9.0, 7.0),
    ]
    all_preds = current_squad + replacements

    plan = suggest_transfers(current_squad=current_squad, all_predictions=all_preds)
    # No improvements because replacements are more expensive (buy_cost > sell_cost skips)
    assert plan.net_points_gain <= 0 or len(plan.transfers) == 0
