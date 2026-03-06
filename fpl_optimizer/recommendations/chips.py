"""Chip advisor – recommends when to play each FPL chip.

FPL chips (2024/25 season):
  - Wildcard (x2): Remove the 4-point hit; replace your entire squad freely.
    Best used after international breaks, big injury crises, or price changes.
  - Free Hit: Play any 15 players for one gameweek; squad reverts afterwards.
    Best used for double gameweeks or blank gameweeks.
  - Triple Captain: Captain's points are tripled instead of doubled.
    Best saved for a gameweek with a reliable attacking premium in a DGW or
    vs a weak opponent.
  - Bench Boost: Points from all 15 squad players (bench included) count.
    Best used in a double gameweek when your bench has good coverage.

Scoring heuristics
------------------
Each chip has a "readiness score" (0–100).  A score above the activation
threshold triggers a recommendation to play the chip.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from fpl_optimizer.analysis.fixture_analyzer import FixtureWindow
from fpl_optimizer.analysis.points_predictor import PlayerPrediction

# ---------------------------------------------------------------------------
# Thresholds and weights
# ---------------------------------------------------------------------------

# Activate Triple Captain if best captain's expected points (doubled) exceeds
# this many points – i.e. their base prediction is very high.
TRIPLE_CAPTAIN_ACTIVATION_XPTS = 8.0

# Activate Bench Boost if average bench expected points exceeds this threshold
BENCH_BOOST_ACTIVATION_BENCH_XPTS = 4.0

# Activate Free Hit if % of starting XI with a blank exceeds this threshold
FREE_HIT_BLANK_THRESHOLD = 0.5  # 50% of starters have a blank

# Activate Free Hit if % of starters with a double exceeds this threshold
FREE_HIT_DOUBLE_THRESHOLD = 0.5


@dataclass
class ChipRecommendation:
    """Recommendation for a single FPL chip."""

    chip: str  # 'wildcard', 'free_hit', 'triple_captain', 'bench_boost'
    recommended: bool
    readiness_score: float  # 0–100
    reason: str

    def display(self) -> str:
        flag = "✓ RECOMMENDED" if self.recommended else "✗ Hold"
        return f"  [{flag:14s}] {self.chip.upper():15s}  (score {self.readiness_score:.0f}/100)  – {self.reason}"


@dataclass
class ChipAdvice:
    """Full chip advice for a gameweek."""

    gameweek: int
    recommendations: list[ChipRecommendation]

    def display(self) -> str:
        lines = [f"--- Chip Advice for GW{self.gameweek} ---"]
        for rec in self.recommendations:
            lines.append(rec.display())
        return "\n".join(lines)


def _double_gameweek_ratio(
    starting_xi: Sequence[PlayerPrediction],
    gameweek: int | None = None,
) -> float:
    """Fraction of starting XI players who have a double gameweek."""
    if not starting_xi:
        return 0.0
    dgw_count = sum(
        1
        for p in starting_xi
        if p.fixture_window
        and p.fixture_window.double_gameweeks
        and (
            gameweek is None
            or gameweek in p.fixture_window.double_gameweeks
        )
    )
    return dgw_count / len(starting_xi)


def _blank_gameweek_ratio(
    starting_xi: Sequence[PlayerPrediction],
    gameweek: int | None = None,
) -> float:
    """Fraction of starting XI players who have a blank gameweek.

    A player is considered to have a blank when their fixture window contains
    no upcoming fixtures (``gameweeks`` is empty) or the target *gameweek* is
    explicitly listed in their ``blank_gameweeks``.
    """
    if not starting_xi:
        return 0.0
    blank_count = 0
    for p in starting_xi:
        if p.fixture_window is None:
            continue
        fw = p.fixture_window
        # Explicit blank listing
        if fw.blank_gameweeks:
            if gameweek is not None and gameweek in fw.blank_gameweeks:
                blank_count += 1
                continue
            # When no specific GW is given, any blank in the window counts
            if gameweek is None:
                blank_count += 1
                continue
        # No fixtures in the window at all → blank
        if not fw.gameweeks:
            blank_count += 1
    return blank_count / len(starting_xi)


def advise_chips(
    gameweek: int,
    starting_xi: Sequence[PlayerPrediction],
    bench: Sequence[PlayerPrediction],
    captain: PlayerPrediction,
    chips_used: set[str] | None = None,
    squad_injury_count: int = 0,
) -> ChipAdvice:
    """Generate chip recommendations for *gameweek*.

    Parameters
    ----------
    gameweek:
        The upcoming gameweek number.
    starting_xi:
        Predicted-points-ranked starting XI.
    bench:
        Bench players (4 players).
    captain:
        The recommended captain from :func:`recommend_captain`.
    chips_used:
        Set of chip names already used this season.  Used to exclude chips
        that are no longer available.
    squad_injury_count:
        Number of players in your squad who are unavailable / doubtful.
    """
    used = chips_used or set()
    recs: list[ChipRecommendation] = []

    dgw_ratio = _double_gameweek_ratio(starting_xi, gameweek=gameweek)
    blank_ratio = _blank_gameweek_ratio(starting_xi, gameweek=gameweek)

    # --- Triple Captain ---
    tc_available = "triple_captain" not in used
    captain_xpts = captain.expected_points
    tc_score = min(100.0, (captain_xpts / TRIPLE_CAPTAIN_ACTIVATION_XPTS) * 60 + dgw_ratio * 40)
    if tc_available:
        if captain_xpts >= TRIPLE_CAPTAIN_ACTIVATION_XPTS and dgw_ratio > 0:
            reason = (
                f"{captain.web_name} has {captain_xpts:.1f} xPts in a DGW – "
                "great time for Triple Captain."
            )
            recs.append(ChipRecommendation("triple_captain", True, tc_score, reason))
        elif captain_xpts >= TRIPLE_CAPTAIN_ACTIVATION_XPTS:
            reason = (
                f"{captain.web_name} has {captain_xpts:.1f} xPts – "
                "consider Triple Captain if no DGW coming up."
            )
            recs.append(ChipRecommendation("triple_captain", False, tc_score, reason))
        else:
            reason = (
                f"{captain.web_name} xPts ({captain_xpts:.1f}) below threshold "
                f"({TRIPLE_CAPTAIN_ACTIVATION_XPTS}). Save for a standout DGW."
            )
            recs.append(ChipRecommendation("triple_captain", False, tc_score, reason))
    else:
        recs.append(ChipRecommendation("triple_captain", False, 0, "Already used."))

    # --- Bench Boost ---
    bb_available = "bench_boost" not in used
    bench_avg_xpts = (
        sum(p.expected_points for p in bench) / len(bench) if bench else 0.0
    )
    bb_score = min(
        100.0,
        (bench_avg_xpts / BENCH_BOOST_ACTIVATION_BENCH_XPTS) * 60 + dgw_ratio * 40,
    )
    if bb_available:
        if bench_avg_xpts >= BENCH_BOOST_ACTIVATION_BENCH_XPTS and dgw_ratio > 0.5:
            reason = (
                f"Bench avg xPts = {bench_avg_xpts:.1f} and "
                f"{dgw_ratio:.0%} of starters have a DGW."
            )
            recs.append(ChipRecommendation("bench_boost", True, bb_score, reason))
        elif bench_avg_xpts >= BENCH_BOOST_ACTIVATION_BENCH_XPTS:
            reason = (
                f"Bench avg xPts = {bench_avg_xpts:.1f} – decent but wait for a DGW."
            )
            recs.append(ChipRecommendation("bench_boost", False, bb_score, reason))
        else:
            reason = (
                f"Bench avg xPts = {bench_avg_xpts:.1f} (below {BENCH_BOOST_ACTIVATION_BENCH_XPTS} threshold). "
                "Strengthen bench before using."
            )
            recs.append(ChipRecommendation("bench_boost", False, bb_score, reason))
    else:
        recs.append(ChipRecommendation("bench_boost", False, 0, "Already used."))

    # --- Free Hit ---
    fh_available = "free_hit" not in used
    fh_score = blank_ratio * 80 + dgw_ratio * 20
    if fh_available:
        if blank_ratio >= FREE_HIT_BLANK_THRESHOLD:
            reason = (
                f"{blank_ratio:.0%} of your starting XI have a blank this GW – "
                "Free Hit to field a full team."
            )
            recs.append(ChipRecommendation("free_hit", True, fh_score, reason))
        elif dgw_ratio >= FREE_HIT_DOUBLE_THRESHOLD:
            reason = (
                f"{dgw_ratio:.0%} of starters have a DGW – "
                "Free Hit to maximise double gameweek coverage."
            )
            recs.append(ChipRecommendation("free_hit", dgw_ratio >= 0.7, fh_score, reason))
        else:
            reason = (
                "No significant blank or double gameweek detected. "
                "Save Free Hit for a high-blank GW."
            )
            recs.append(ChipRecommendation("free_hit", False, fh_score, reason))
    else:
        recs.append(ChipRecommendation("free_hit", False, 0, "Already used."))

    # --- Wildcard ---
    # Wildcard is nuanced – recommend if squad is heavily injured or many
    # cheap players have become expensive / fallen out of favour.
    wc_available = "wildcard" not in used
    wc_score = min(100.0, squad_injury_count * 15 + blank_ratio * 20)
    if wc_available:
        if squad_injury_count >= 3:
            reason = (
                f"{squad_injury_count} players unavailable/doubtful – "
                "Wildcard to reset your squad structure."
            )
            recs.append(ChipRecommendation("wildcard", True, wc_score, reason))
        elif squad_injury_count >= 2:
            reason = (
                f"{squad_injury_count} injury concerns. "
                "Consider Wildcard if assets are expensive to replace."
            )
            recs.append(ChipRecommendation("wildcard", False, wc_score, reason))
        else:
            reason = "Squad looks healthy. Save Wildcard for a crisis or major price changes."
            recs.append(ChipRecommendation("wildcard", False, wc_score, reason))
    else:
        recs.append(ChipRecommendation("wildcard", False, 0, "Already used."))

    return ChipAdvice(gameweek=gameweek, recommendations=recs)
