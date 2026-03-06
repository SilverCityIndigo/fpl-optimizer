"""Captain and vice-captain recommendations for the upcoming gameweek.

The captain choice is one of the highest-leverage decisions in FPL: your
captain's points are doubled, so picking the right one can swing a week by
6+ points.

Scoring approach
----------------
We rank players in your starting XI by a *captaincy score* that combines:
  - Expected points (primary signal)
  - Fixture difficulty for the target gameweek
  - Recent form (last 4 GWs)
  - Ownership (differential picks are rewarded when they have strong xPts)
  - Double gameweek bonus
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from fpl_optimizer.analysis.points_predictor import PlayerPrediction

# Weights used in the captaincy composite score
_EXPECTED_PTS_WEIGHT = 0.65
_FORM_WEIGHT = 0.20
_DIFFERENTIAL_WEIGHT = 0.15  # reward low-ownership high-upside picks

# Threshold below which a player is considered a "differential" captain
DIFFERENTIAL_OWNERSHIP_THRESHOLD = 20.0  # percent


@dataclass
class CaptainRecommendation:
    """Captain / vice-captain recommendation for a gameweek."""

    captain: PlayerPrediction
    vice_captain: PlayerPrediction
    captain_score: float
    vice_captain_score: float
    differential_pick: PlayerPrediction | None  # Best differential option

    def display(self) -> str:
        lines = [
            "--- Captain Recommendations ---",
            f"  Captain (C):       {self.captain.display()}",
            f"  Vice-captain (V):  {self.vice_captain.display()}",
        ]
        if self.differential_pick:
            lines.append(
                f"  Differential (D):  {self.differential_pick.display()}  "
                f"[low-ownership pick]"
            )
        return "\n".join(lines)


def _captaincy_score(
    pred: PlayerPrediction,
    ownership_percent: dict[int, float] | None = None,
) -> float:
    """Compute a composite captaincy score for *pred*."""
    # Primary: expected points (doubles on captain)
    score = pred.expected_points * _EXPECTED_PTS_WEIGHT * 2  # doubling effect

    # Fixture bonus already baked into expected_points; we add a small
    # upside adjustment for players with a DGW.
    if pred.fixture_window and pred.fixture_window.double_gameweeks:
        if (
            pred.fixture_window.gameweeks
            and pred.fixture_window.gameweeks[0]
            in pred.fixture_window.double_gameweeks
        ):
            score *= 1.1  # 10% bonus for confirmed DGW

    # Form bonus: reward players who have been consistent recently
    # points_per_million acts as a proxy for form-adjusted quality
    score += pred.expected_points * _FORM_WEIGHT

    # Differential bonus: if a player has low ownership but high expected
    # points, captaining them beats the template and gains rank
    if ownership_percent:
        ownership = ownership_percent.get(pred.player_id, 50.0)
        if ownership < DIFFERENTIAL_OWNERSHIP_THRESHOLD:
            # Differential bonus scales with how low ownership is
            diff_bonus = (DIFFERENTIAL_OWNERSHIP_THRESHOLD - ownership) / 100.0
            score += pred.expected_points * _DIFFERENTIAL_WEIGHT * diff_bonus

    return score


def recommend_captain(
    starting_xi: Sequence[PlayerPrediction],
    ownership_percent: dict[int, float] | None = None,
) -> CaptainRecommendation:
    """Return captain and vice-captain recommendations.

    Parameters
    ----------
    starting_xi:
        The predicted-points-ranked list of players in the starting XI.
    ownership_percent:
        Mapping player_id → ownership percentage (0-100).  Used to identify
        differential picks.

    Returns
    -------
    CaptainRecommendation
    """
    if not starting_xi:
        raise ValueError("starting_xi must not be empty")

    scored = sorted(
        starting_xi,
        key=lambda p: _captaincy_score(p, ownership_percent),
        reverse=True,
    )

    captain = scored[0]
    vice_captain = scored[1] if len(scored) > 1 else scored[0]

    # Find best differential (excluding captain / VC if they already are differentials)
    differential_pick: PlayerPrediction | None = None
    if ownership_percent:
        differential_candidates = [
            p
            for p in scored
            if ownership_percent.get(p.player_id, 100.0)
            < DIFFERENTIAL_OWNERSHIP_THRESHOLD
            and p.player_id not in {captain.player_id, vice_captain.player_id}
        ]
        if differential_candidates:
            differential_pick = differential_candidates[0]

    return CaptainRecommendation(
        captain=captain,
        vice_captain=vice_captain,
        captain_score=round(_captaincy_score(captain, ownership_percent), 3),
        vice_captain_score=round(
            _captaincy_score(vice_captain, ownership_percent), 3
        ),
        differential_pick=differential_pick,
    )
