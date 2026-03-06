"""Squad optimizer using Integer Linear Programming (ILP).

Uses the PuLP library to select the 15-player squad and starting 11 that
maximises expected FPL points subject to the official FPL constraints:

Squad constraints (15 players):
  - Budget ≤ £100m (1000 in tenths)
  - Exactly 2 goalkeepers
  - Exactly 5 defenders
  - Exactly 5 midfielders
  - Exactly 3 forwards
  - Maximum 3 players from any single Premier League club

Starting 11 constraints:
  - Exactly 1 goalkeeper
  - Minimum 3 defenders
  - Minimum 2 midfielders
  - Minimum 1 forward
  - Exactly 11 outfield + GKP players

Transfer optimizer:
  - Given a current squad and a number of free transfers, find the set of
    transfers that maximises the improvement in expected total points while
    accounting for the 4-point hit per additional transfer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import pulp

from fpl_optimizer.analysis.points_predictor import PlayerPrediction

# ---------------------------------------------------------------------------
# Squad structure constants
# ---------------------------------------------------------------------------

BUDGET = 1000  # £100.0m in FPL's integer (tenths) representation
MAX_PLAYERS_PER_TEAM = 3

SQUAD_SIZE = 15
GKP_COUNT = 2
DEF_COUNT = 5
MID_COUNT = 5
FWD_COUNT = 3

STARTING_XI = 11
STARTING_GKP = 1
MIN_STARTING_DEF = 3
MIN_STARTING_MID = 2
MIN_STARTING_FWD = 1

# Transfer hit (points deducted per transfer beyond free transfers)
TRANSFER_HIT = 4


@dataclass
class OptimizedSquad:
    """Result of a squad optimisation run."""

    squad: list[PlayerPrediction]  # All 15 players
    starting_xi: list[PlayerPrediction]  # Starting 11
    bench: list[PlayerPrediction]  # Bench 4 (ordered: GKP last)
    captain: PlayerPrediction
    vice_captain: PlayerPrediction
    total_cost: float  # In millions
    total_predicted_points: float  # Sum of starting XI (captain doubled)
    status: str  # PuLP solver status

    def display(self) -> str:
        lines: list[str] = ["=" * 60, "OPTIMIZED SQUAD", "=" * 60]
        for pos in ("GKP", "DEF", "MID", "FWD"):
            pos_players = [p for p in self.starting_xi if p.position == pos]
            lines.append(f"\n  {pos}:")
            for p in pos_players:
                tag = ""
                if p.player_id == self.captain.player_id:
                    tag = " [C]"
                elif p.player_id == self.vice_captain.player_id:
                    tag = " [V]"
                lines.append(f"    {p.display()}{tag}")
        lines.append(f"\n  BENCH:")
        for p in self.bench:
            lines.append(f"    {p.display()}")
        lines.append(
            f"\nTotal cost: £{self.total_cost:.1f}m  |  "
            f"Projected points: {self.total_predicted_points:.1f}"
        )
        return "\n".join(lines)


def optimize_squad(
    predictions: Sequence[PlayerPrediction],
    budget: int = BUDGET,
    player_costs: dict[int, int] | None = None,
    player_team_ids: dict[int, int] | None = None,
) -> OptimizedSquad:
    """Select the optimal 15-player squad and starting 11.

    Parameters
    ----------
    predictions:
        Expected points predictions for candidate players.
    budget:
        Maximum squad cost in tenths of millions (default 1000 = £100m).
    player_costs:
        Mapping player_id → cost in tenths.  If ``None``, uses
        ``prediction.cost * 10`` (rounded).
    player_team_ids:
        Mapping player_id → FPL team_id.  Required for the 3-per-club rule.
        If ``None``, the rule is skipped.

    Returns
    -------
    OptimizedSquad
    """
    prob = pulp.LpProblem("FPL_Squad_Optimizer", pulp.LpMaximize)

    n = len(predictions)
    idx = range(n)

    # Decision variables: x[i]=1 if player i is in the squad
    x = [pulp.LpVariable(f"x_{i}", cat="Binary") for i in idx]
    # s[i]=1 if player i is in the starting XI
    s = [pulp.LpVariable(f"s_{i}", cat="Binary") for i in idx]

    # --- Objective: maximise total expected points for starting XI ---
    prob += pulp.lpSum(s[i] * predictions[i].expected_points for i in idx)

    # --- Budget ---
    costs = []
    for i in idx:
        p = predictions[i]
        if player_costs and p.player_id in player_costs:
            costs.append(player_costs[p.player_id])
        else:
            costs.append(round(p.cost * 10))
    prob += pulp.lpSum(x[i] * costs[i] for i in idx) <= budget

    # --- Squad composition ---
    gkp = [i for i in idx if predictions[i].position == "GKP"]
    defs = [i for i in idx if predictions[i].position == "DEF"]
    mids = [i for i in idx if predictions[i].position == "MID"]
    fwds = [i for i in idx if predictions[i].position == "FWD"]

    prob += pulp.lpSum(x[i] for i in gkp) == GKP_COUNT
    prob += pulp.lpSum(x[i] for i in defs) == DEF_COUNT
    prob += pulp.lpSum(x[i] for i in mids) == MID_COUNT
    prob += pulp.lpSum(x[i] for i in fwds) == FWD_COUNT

    # --- Maximum 3 players per club ---
    if player_team_ids:
        teams: set[int] = set(player_team_ids.values())
        for team_id in teams:
            team_players = [
                i
                for i in idx
                if player_team_ids.get(predictions[i].player_id) == team_id
            ]
            if team_players:
                prob += pulp.lpSum(x[i] for i in team_players) <= MAX_PLAYERS_PER_TEAM

    # --- Starting XI must be a subset of the squad ---
    for i in idx:
        prob += s[i] <= x[i]

    # --- Starting XI size and formation ---
    prob += pulp.lpSum(s[i] for i in idx) == STARTING_XI
    prob += pulp.lpSum(s[i] for i in gkp) == STARTING_GKP
    prob += pulp.lpSum(s[i] for i in defs) >= MIN_STARTING_DEF
    prob += pulp.lpSum(s[i] for i in mids) >= MIN_STARTING_MID
    prob += pulp.lpSum(s[i] for i in fwds) >= MIN_STARTING_FWD

    # Solve (suppress solver output)
    solver = pulp.PULP_CBC_CMD(msg=0)
    prob.solve(solver)

    status = pulp.LpStatus[prob.status]

    # Extract results
    squad_players = [predictions[i] for i in idx if pulp.value(x[i]) == 1]
    starting_xi = [predictions[i] for i in idx if pulp.value(s[i]) == 1]
    bench = [p for p in squad_players if p not in starting_xi]

    # Sort positions for display
    _pos_order = {"GKP": 0, "DEF": 1, "MID": 2, "FWD": 3}
    starting_xi.sort(
        key=lambda p: (_pos_order.get(p.position, 9), -p.expected_points)
    )
    # Bench: outfield players first, backup GKP last
    bench.sort(
        key=lambda p: (
            1 if p.position == "GKP" else 0,
            -p.expected_points,
        )
    )

    # Captain = highest expected points in starting XI
    captain = max(starting_xi, key=lambda p: p.expected_points)
    vice_captain = max(
        (p for p in starting_xi if p.player_id != captain.player_id),
        key=lambda p: p.expected_points,
        default=captain,
    )

    total_cost_tenths = sum(
        costs[i] for i in idx if pulp.value(x[i]) == 1
    )

    # Points include captain doubling
    xi_pts = sum(p.expected_points for p in starting_xi)
    xi_pts += captain.expected_points  # captain doubles

    return OptimizedSquad(
        squad=squad_players,
        starting_xi=starting_xi,
        bench=bench,
        captain=captain,
        vice_captain=vice_captain,
        total_cost=total_cost_tenths / 10.0,
        total_predicted_points=round(xi_pts, 2),
        status=status,
    )


@dataclass
class TransferSuggestion:
    """A single suggested transfer (sell one player, buy another)."""

    sell: PlayerPrediction
    buy: PlayerPrediction
    points_gain: float  # Expected points improvement (before hit)
    cost_delta: float  # Positive = more expensive, negative = frees up funds

    def display(self) -> str:
        sign = "+" if self.cost_delta >= 0 else ""
        return (
            f"OUT: {self.sell.display()}  →  "
            f"IN: {self.buy.display()}  "
            f"(+{self.points_gain:.2f}pts, {sign}£{self.cost_delta:.1f}m)"
        )


@dataclass
class TransferPlan:
    """Recommended transfer plan for the upcoming gameweek."""

    transfers: list[TransferSuggestion]
    free_transfers: int
    net_points_gain: float  # After deducting transfer hits

    def display(self) -> str:
        lines = [f"Transfer Plan (FTs: {self.free_transfers})"]
        for i, t in enumerate(self.transfers, 1):
            lines.append(f"  Transfer {i}: {t.display()}")
        hits = max(0, len(self.transfers) - self.free_transfers) * TRANSFER_HIT
        lines.append(
            f"Hit: -{hits}pts  |  Net gain: {self.net_points_gain:.2f}pts"
        )
        return "\n".join(lines)


def suggest_transfers(
    current_squad: list[PlayerPrediction],
    all_predictions: Sequence[PlayerPrediction],
    player_costs: dict[int, int] | None = None,
    player_team_ids: dict[int, int] | None = None,
    free_transfers: int = 1,
    max_transfers: int = 2,
) -> TransferPlan:
    """Suggest the best transfers for the upcoming gameweek.

    For each player in *current_squad*, find the best available replacement
    (higher expected points, within budget, valid squad constraints).  Returns
    the top *max_transfers* single transfers ordered by net points gain after
    accounting for hits.

    Parameters
    ----------
    current_squad:
        Your current 15-player squad.
    all_predictions:
        Full list of player predictions (including players not in squad).
    player_costs:
        Mapping player_id → cost in tenths.
    player_team_ids:
        Mapping player_id → FPL team_id (for the 3-per-club constraint).
    free_transfers:
        Number of free transfers available.
    max_transfers:
        Maximum number of transfers to suggest (default 2).
    """
    squad_ids = {p.player_id for p in current_squad}
    available = [p for p in all_predictions if p.player_id not in squad_ids]

    # Current team composition for the 3-per-club check
    team_counts: dict[int, int] = {}
    if player_team_ids:
        for p in current_squad:
            tid = player_team_ids.get(p.player_id, 0)
            team_counts[tid] = team_counts.get(tid, 0) + 1

    def _cost(pred: PlayerPrediction) -> int:
        """Return player cost in tenths of millions."""
        if player_costs:
            return player_costs.get(pred.player_id, round(pred.cost * 10))
        return round(pred.cost * 10)

    suggestions: list[TransferSuggestion] = []

    for sell in current_squad:
        sell_cost = _cost(sell)
        sell_team = player_team_ids.get(sell.player_id, 0) if player_team_ids else 0

        for buy in available:
            if buy.position != sell.position:
                continue  # Must be same position for a direct swap

            buy_cost = _cost(buy)
            buy_team = player_team_ids.get(buy.player_id, 0) if player_team_ids else 0

            # Budget check
            if buy_cost > sell_cost:
                continue  # simplified: require same or cheaper price

            # 3-per-club check
            if player_team_ids and buy_team != sell_team:
                current_buy_team_count = team_counts.get(buy_team, 0)
                if current_buy_team_count >= MAX_PLAYERS_PER_TEAM:
                    continue

            gain = buy.expected_points - sell.expected_points
            if gain <= 0:
                continue

            suggestions.append(
                TransferSuggestion(
                    sell=sell,
                    buy=buy,
                    points_gain=gain,
                    cost_delta=(buy_cost - sell_cost) / 10.0,
                )
            )

    # Sort by points gain descending
    suggestions.sort(key=lambda s: s.points_gain, reverse=True)

    # Take top N non-overlapping transfers (each player can only be involved once)
    chosen: list[TransferSuggestion] = []
    used_sell: set[int] = set()
    used_buy: set[int] = set()
    for sug in suggestions:
        if sug.sell.player_id in used_sell or sug.buy.player_id in used_buy:
            continue
        chosen.append(sug)
        used_sell.add(sug.sell.player_id)
        used_buy.add(sug.buy.player_id)
        if len(chosen) >= max_transfers:
            break

    hits = max(0, len(chosen) - free_transfers) * TRANSFER_HIT
    net_gain = sum(s.points_gain for s in chosen) - hits

    return TransferPlan(
        transfers=chosen,
        free_transfers=free_transfers,
        net_points_gain=round(net_gain, 2),
    )
