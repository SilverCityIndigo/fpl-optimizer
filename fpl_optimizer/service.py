"""High-level FPL Optimizer service.

This module is the main entry point for the analysis pipeline.  It fetches
data from the FPL API, builds predictions, and returns recommendations.
"""

from __future__ import annotations

from typing import Any

from fpl_optimizer.analysis.fixture_analyzer import analyse_fixtures
from fpl_optimizer.analysis.points_predictor import PlayerPrediction, predict_all
from fpl_optimizer.data import fetcher
from fpl_optimizer.models.player import Fixture, Player, Team
from fpl_optimizer.optimizer.squad_optimizer import OptimizedSquad, optimize_squad
from fpl_optimizer.recommendations.captain import (
    CaptainRecommendation,
    recommend_captain,
)
from fpl_optimizer.recommendations.chips import ChipAdvice, advise_chips
from fpl_optimizer.recommendations.transfers import (
    SellCandidate,
    TransferPlan,
    get_transfer_plan,
)


class FPLService:
    """Orchestrates data fetching, prediction, and recommendations.

    Usage::

        svc = FPLService()
        svc.load()

        # Get the optimal squad from scratch
        result = svc.optimal_squad()
        print(result.display())

        # Captain recommendation for current GW
        captain = svc.captain_pick(result.starting_xi)
        print(captain.display())
    """

    def __init__(self) -> None:
        self._bootstrap: dict[str, Any] | None = None
        self._players: list[Player] = []
        self._teams: list[Team] = []
        self._fixtures: list[Fixture] = []
        self._current_gw: int = 1
        self._predictions: list[PlayerPrediction] = []
        self._player_team_ids: dict[int, int] = {}
        self._player_costs: dict[int, int] = {}
        self._ownership: dict[int, float] = {}

    # ------------------------------------------------------------------
    # Data loading
    # ------------------------------------------------------------------

    def load(self) -> None:
        """Fetch all data from the FPL API and build predictions."""
        bootstrap = fetcher.get_bootstrap()
        self._bootstrap = bootstrap

        # Parse teams
        self._teams = [Team.from_api(t) for t in bootstrap.get("teams", [])]

        # Parse players
        self._players = [Player.from_api(p) for p in bootstrap.get("elements", [])]

        # Current gameweek
        events = bootstrap.get("events", [])
        for event in events:
            if event.get("is_current"):
                self._current_gw = event["id"]
                break
        else:
            # Fall back to the next gameweek
            for event in events:
                if event.get("is_next"):
                    self._current_gw = event["id"]
                    break

        # Fetch fixtures
        raw_fixtures = fetcher.get_fixtures()
        self._fixtures = [Fixture.from_api(f) for f in raw_fixtures]

        # Build lookup maps
        self._player_team_ids = {p.id: p.team_id for p in self._players}
        self._player_costs = {p.id: p.now_cost for p in self._players}
        self._ownership = {p.id: p.selected_by_percent for p in self._players}

        # Build predictions
        self._build_predictions()

    def _build_predictions(self) -> None:
        """Build per-player predictions using fixtures and form data."""
        fixture_windows = {
            p.id: analyse_fixtures(
                p, self._fixtures, self._current_gw, num_gws=5
            )
            for p in self._players
        }

        # Estimate games played from minutes
        games_played_map = {
            p.id: max(1, round(p.minutes / 90)) if p.minutes else 1
            for p in self._players
        }

        self._predictions = predict_all(
            self._players,
            fixture_windows=fixture_windows,
            games_played_map=games_played_map,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def current_gameweek(self) -> int:
        return self._current_gw

    @property
    def predictions(self) -> list[PlayerPrediction]:
        return self._predictions

    def top_players(self, n: int = 20, position: str | None = None) -> list[PlayerPrediction]:
        """Return the top *n* predicted players, optionally filtered by position."""
        preds = self._predictions
        if position:
            preds = [p for p in preds if p.position == position.upper()]
        return preds[:n]

    def optimal_squad(self, budget: int = 1000) -> OptimizedSquad:
        """Return the optimal 15-player squad within *budget* (tenths of £m)."""
        return optimize_squad(
            self._predictions,
            budget=budget,
            player_costs=self._player_costs,
            player_team_ids=self._player_team_ids,
        )

    def captain_pick(
        self,
        starting_xi: list[PlayerPrediction] | None = None,
    ) -> CaptainRecommendation:
        """Return captain and vice-captain recommendations.

        If *starting_xi* is not provided, the optimal squad's starting XI is used.
        """
        if starting_xi is None:
            starting_xi = self.optimal_squad().starting_xi
        return recommend_captain(starting_xi, self._ownership)

    def chip_advice(
        self,
        starting_xi: list[PlayerPrediction] | None = None,
        bench: list[PlayerPrediction] | None = None,
        chips_used: set[str] | None = None,
        squad_injury_count: int = 0,
    ) -> ChipAdvice:
        """Return chip recommendations for the current gameweek."""
        squad = self.optimal_squad()
        if starting_xi is None:
            starting_xi = squad.starting_xi
        if bench is None:
            bench = squad.bench
        captain = recommend_captain(starting_xi, self._ownership).captain
        return advise_chips(
            gameweek=self._current_gw,
            starting_xi=starting_xi,
            bench=bench,
            captain=captain,
            chips_used=chips_used,
            squad_injury_count=squad_injury_count,
        )

    def transfer_plan(
        self,
        current_squad: list[PlayerPrediction],
        free_transfers: int = 1,
        max_transfers: int = 2,
    ) -> tuple[TransferPlan, list[SellCandidate]]:
        """Recommend transfers for your current squad."""
        return get_transfer_plan(
            current_squad=current_squad,
            all_predictions=self._predictions,
            player_costs=self._player_costs,
            player_team_ids=self._player_team_ids,
            free_transfers=free_transfers,
            max_transfers=max_transfers,
        )
