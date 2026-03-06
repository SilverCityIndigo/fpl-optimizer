"""Fixture difficulty analysis.

Provides per-player fixture difficulty scores for a configurable look-ahead
window of gameweeks.  A lower score means easier fixtures (better for FPL).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from fpl_optimizer.models.player import Fixture, Player


@dataclass
class FixtureWindow:
    """Fixture difficulty summary for a player over a look-ahead window."""

    player_id: int
    gameweeks: list[int]
    difficulties: list[int]  # FDR score per gameweek (1=easiest … 5=hardest)
    double_gameweeks: list[int]  # Gameweeks with 2 fixtures
    blank_gameweeks: list[int]  # Gameweeks with 0 fixtures

    @property
    def average_difficulty(self) -> float:
        """Mean difficulty over the window (lower = easier)."""
        if not self.difficulties:
            return 3.0
        return sum(self.difficulties) / len(self.difficulties)

    @property
    def fixture_score(self) -> float:
        """
        A composite score (higher = better FPL prospects) that rewards:
          - easy fixtures (low difficulty)
          - double gameweeks (extra fixture = extra point-scoring opportunity)
          - penalises blank gameweeks
        """
        base = (6.0 - self.average_difficulty)  # invert so higher = easier
        dgw_bonus = len(self.double_gameweeks) * 1.5
        bgw_penalty = len(self.blank_gameweeks) * 2.0
        return base + dgw_bonus - bgw_penalty


def build_fixture_map(
    fixtures: Sequence[Fixture],
    team_id: int,
    start_gw: int,
    num_gws: int,
) -> dict[int, list[Fixture]]:
    """Map gameweek number → list of fixtures involving *team_id*."""
    gw_map: dict[int, list[Fixture]] = {
        gw: [] for gw in range(start_gw, start_gw + num_gws)
    }
    for f in fixtures:
        if f.gameweek is None or f.gameweek not in gw_map:
            continue
        if f.home_team_id == team_id or f.away_team_id == team_id:
            gw_map[f.gameweek].append(f)
    return gw_map


def analyse_fixtures(
    player: Player,
    fixtures: Sequence[Fixture],
    start_gw: int,
    num_gws: int = 5,
) -> FixtureWindow:
    """Compute fixture difficulty for *player* over the next *num_gws* gameweeks.

    Parameters
    ----------
    player:
        The player to analyse.
    fixtures:
        Full list of season fixtures (from the FPL API).
    start_gw:
        The first gameweek of the look-ahead window.
    num_gws:
        Number of gameweeks to look ahead (default 5).
    """
    gw_map = build_fixture_map(fixtures, player.team_id, start_gw, num_gws)

    all_difficulties: list[int] = []
    gameweeks: list[int] = []
    double_gameweeks: list[int] = []
    blank_gameweeks: list[int] = []

    for gw in range(start_gw, start_gw + num_gws):
        gw_fixtures = gw_map.get(gw, [])
        if len(gw_fixtures) == 0:
            blank_gameweeks.append(gw)
            continue
        if len(gw_fixtures) >= 2:
            double_gameweeks.append(gw)

        for f in gw_fixtures:
            if f.home_team_id == player.team_id:
                fdr = f.home_team_difficulty
            else:
                fdr = f.away_team_difficulty
            all_difficulties.append(fdr)
            gameweeks.append(gw)

    return FixtureWindow(
        player_id=player.id,
        gameweeks=gameweeks,
        difficulties=all_difficulties,
        double_gameweeks=double_gameweeks,
        blank_gameweeks=blank_gameweeks,
    )


def rank_by_fixtures(
    players: Sequence[Player],
    fixtures: Sequence[Fixture],
    start_gw: int,
    num_gws: int = 5,
) -> list[tuple[Player, FixtureWindow]]:
    """Return players sorted by descending fixture score (best fixtures first).

    This is useful for comparing players in the same position when deciding
    who to buy or target for captaincy.
    """
    results = [
        (p, analyse_fixtures(p, fixtures, start_gw, num_gws)) for p in players
    ]
    results.sort(key=lambda x: x[1].fixture_score, reverse=True)
    return results
