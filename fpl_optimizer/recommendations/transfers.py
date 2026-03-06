"""Transfer recommendations module.

Provides high-level helpers for generating and displaying transfer plans.
The core logic lives in :mod:`fpl_optimizer.optimizer.squad_optimizer`; this
module wraps it with additional context such as price-change alerts and
suggested sell candidates ranked by a ``sell score``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from fpl_optimizer.analysis.points_predictor import PlayerPrediction
from fpl_optimizer.optimizer.squad_optimizer import (
    TransferPlan,
    suggest_transfers,
)

# Sell score weights
_FORM_DECLINE_WEIGHT = 0.5
_FIXTURE_DIFFICULTY_WEIGHT = 0.3
_INJURY_RISK_WEIGHT = 0.2


@dataclass
class SellCandidate:
    """A player recommended for transfer out."""

    player: PlayerPrediction
    sell_score: float  # 0–100; higher = stronger sell signal
    reason: str

    def display(self) -> str:
        return (
            f"  SELL {self.player.display()}  "
            f"(sell score {self.sell_score:.0f}/100)  – {self.reason}"
        )


def _sell_score(player: PlayerPrediction) -> tuple[float, str]:
    """Compute a sell score for *player*.  Higher = should sell sooner."""
    score = 0.0
    reasons: list[str] = []

    # Low expected points vs cost
    pts_per_million = player.points_per_million
    if pts_per_million < 0.5:
        pts_deficit = 0.5 - pts_per_million
        score += min(40.0, pts_deficit * 100)
        reasons.append(f"low value ({pts_per_million:.2f} pts/£m)")

    # Poor fixture window
    if player.fixture_window and player.fixture_window.average_difficulty >= 4.0:
        difficulty_delta = player.fixture_window.average_difficulty - 3.0
        score += min(30.0, difficulty_delta * 15)
        reasons.append(
            f"tough fixtures (avg FDR {player.fixture_window.average_difficulty:.1f})"
        )

    # Injury / availability risk
    if player.availability_chance < 1.0:
        risk = (1.0 - player.availability_chance) * 40.0
        score += risk
        reasons.append(
            f"availability risk ({player.availability_chance:.0%} chance of playing)"
        )

    # Blank gameweek
    if player.fixture_window and player.fixture_window.blank_gameweeks:
        score += 20.0
        reasons.append("has a blank gameweek")

    reason_str = "; ".join(reasons) if reasons else "adequate asset"
    return min(score, 100.0), reason_str


def rank_sell_candidates(
    squad: Sequence[PlayerPrediction],
    top_n: int = 5,
) -> list[SellCandidate]:
    """Rank squad players by how urgently they should be sold.

    Parameters
    ----------
    squad:
        Your current 15-player squad predictions.
    top_n:
        Number of sell candidates to return.
    """
    candidates: list[SellCandidate] = []
    for p in squad:
        score, reason = _sell_score(p)
        candidates.append(SellCandidate(player=p, sell_score=score, reason=reason))

    candidates.sort(key=lambda c: c.sell_score, reverse=True)
    return candidates[:top_n]


def get_transfer_plan(
    current_squad: list[PlayerPrediction],
    all_predictions: Sequence[PlayerPrediction],
    player_costs: dict[int, int] | None = None,
    player_team_ids: dict[int, int] | None = None,
    free_transfers: int = 1,
    max_transfers: int = 2,
) -> tuple[TransferPlan, list[SellCandidate]]:
    """Generate a full transfer plan with sell candidates and replacements.

    Returns
    -------
    (TransferPlan, list[SellCandidate])
        The recommended transfers and a ranked list of sell candidates.
    """
    plan = suggest_transfers(
        current_squad=current_squad,
        all_predictions=all_predictions,
        player_costs=player_costs,
        player_team_ids=player_team_ids,
        free_transfers=free_transfers,
        max_transfers=max_transfers,
    )
    sell_candidates = rank_sell_candidates(current_squad)
    return plan, sell_candidates
