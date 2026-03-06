"""Expected points predictor for FPL players.

The model blends:
  1. Recent form (rolling average over the last *form_gws* gameweeks)
  2. Season-long points-per-game
  3. Opta ICT index (normalised)
  4. Expected goals (xG) and expected assists (xA) from Opta data embedded in
     the FPL API
  5. Fixture difficulty adjustment for the target gameweek

Predicted points are then adjusted for availability risk (injury, suspension,
rotation) to produce an *expected* points figure that accounts for the chance
the player does not actually play.

All scoring constants are based on the official FPL points system
(2024/25 season rules).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from fpl_optimizer.analysis.fixture_analyzer import FixtureWindow
from fpl_optimizer.models.player import (
    POSITION_ID,
    Player,
)

# ---------------------------------------------------------------------------
# FPL points system constants
# ---------------------------------------------------------------------------

# Points for playing time
POINTS_PLAYED_60_PLUS = 2
POINTS_PLAYED_1_TO_59 = 1

# Goals scored
GOALS_POINTS = {
    1: 6,  # GKP
    2: 6,  # DEF
    3: 5,  # MID
    4: 4,  # FWD
}

# Assists
ASSIST_POINTS = 3

# Clean sheet (goalkeeper / defender get 4, midfielder gets 1, forward 0)
CLEAN_SHEET_POINTS = {
    1: 4,  # GKP
    2: 4,  # DEF
    3: 1,  # MID
    4: 0,  # FWD
}

# Saves (every 3 saves = 1 point for GKP)
SAVE_POINTS_PER_SAVE = 1 / 3

# Goals conceded (every 2 goals conceded = -1 for GKP/DEF)
GOALS_CONCEDED_PENALTY_PER_GOAL = {
    1: -0.5,  # GKP: -1 per 2 goals
    2: -0.5,  # DEF
    3: 0,
    4: 0,
}

# Bonus points: average ~1.5 for active players in top half of BPS
AVERAGE_BONUS = 1.2

# Yellow / red card penalties
YELLOW_CARD_PENALTY = -1
RED_CARD_PENALTY = -3

# Fixture difficulty rating (FDR) adjustment multipliers
# FDR 1 = very easy (+15%), FDR 5 = very hard (-20%)
FDR_MULTIPLIER = {1: 1.15, 2: 1.08, 3: 1.00, 4: 0.90, 5: 0.80}

# Weight given to form vs season PPG when blending
FORM_WEIGHT = 0.6
PPG_WEIGHT = 0.4

# Minimum minutes threshold to be considered a regular starter
MIN_MINUTES_FOR_STARTER = 45


@dataclass
class PlayerPrediction:
    """Predicted points for a player for a given gameweek."""

    player_id: int
    web_name: str
    position: str
    cost: float
    predicted_points: float  # Base prediction (assuming player plays)
    expected_points: float  # Availability-adjusted prediction
    availability_chance: float  # 0.0–1.0
    fixture_window: FixtureWindow | None = None

    @property
    def points_per_million(self) -> float:
        """Expected points divided by cost – a key value metric in FPL."""
        if self.cost == 0:
            return 0.0
        return self.expected_points / self.cost

    def display(self) -> str:
        return (
            f"{self.web_name} ({self.position}, £{self.cost:.1f}m) "
            f"xPts={self.expected_points:.2f}  "
            f"(£{self.points_per_million:.2f}pts/£m)"
        )


def _availability_chance(player: Player) -> float:
    """Estimate the probability that *player* actually plays in the next GW."""
    if player.status == "i":
        return 0.0
    if player.status == "s":
        return 0.0
    if player.status == "u":
        return 0.0
    if player.chance_of_playing_next_round is not None:
        return player.chance_of_playing_next_round / 100.0
    # Doubtful – conservative estimate
    if player.status == "d":
        return 0.5
    return 1.0


def _base_points_from_stats(player: Player, games_played: int) -> float:
    """Estimate per-game points from a player's raw season stats.

    This gives a bottom-up view that is then blended with form and PPG.
    """
    if games_played == 0:
        return 0.0

    pos = player.position_id

    # Playing time points (assume 90 min per game for simplicity)
    pts = POINTS_PLAYED_60_PLUS

    # Goals
    goals_per_game = player.goals_scored / games_played
    pts += goals_per_game * GOALS_POINTS[pos]

    # Assists
    assists_per_game = player.assists / games_played
    pts += assists_per_game * ASSIST_POINTS

    # Clean sheets (only meaningful for GKP/DEF/MID)
    cs_per_game = player.clean_sheets / games_played
    pts += cs_per_game * CLEAN_SHEET_POINTS[pos]

    # Goals conceded (only GKP/DEF)
    gc_per_game = player.goals_conceded / games_played
    pts += gc_per_game * GOALS_CONCEDED_PENALTY_PER_GOAL.get(pos, 0)

    # Saves (GKP only)
    if pos == 1:
        saves_per_game = player.saves / games_played
        pts += saves_per_game * SAVE_POINTS_PER_SAVE

    # Bonus points
    bps_per_game = player.bps / games_played
    # Scale: top BPS earner gets ~3 bonus, mid-range ~1.2
    pts += min(bps_per_game / 25.0, 3.0)

    # Yellow / red cards (rare events – season average)
    pts += (player.yellow_cards / games_played) * YELLOW_CARD_PENALTY
    pts += (player.red_cards / games_played) * RED_CARD_PENALTY

    return max(pts, 0.0)


def predict_player(
    player: Player,
    fixture_window: FixtureWindow | None = None,
    games_played: int | None = None,
) -> PlayerPrediction:
    """Predict expected FPL points for *player* for the next gameweek.

    Parameters
    ----------
    player:
        The player to predict for.
    fixture_window:
        Pre-computed fixture difficulty window.  If provided, the first
        gameweek's difficulty is used to adjust the base prediction.
    games_played:
        Number of gameweeks the player has participated in.  If ``None``,
        this is estimated from minutes played.
    """
    if games_played is None:
        # Estimate games played from total minutes (rough heuristic)
        games_played = max(1, round(player.minutes / 90)) if player.minutes else 1

    # --- 1. Bottom-up stats-based estimate ---
    stats_ppg = _base_points_from_stats(player, games_played)

    # --- 2. Blend with FPL form and PPG ---
    # FPL form is average pts over last 4–5 GWs; PPG is season average
    blended_ppg = (
        FORM_WEIGHT * player.form
        + PPG_WEIGHT * player.points_per_game
    )

    # Weight blended form more heavily when we have enough games
    if games_played >= 5:
        base = 0.5 * blended_ppg + 0.5 * stats_ppg
    else:
        # Early season: trust stats-based estimate more
        base = 0.3 * blended_ppg + 0.7 * stats_ppg

    # --- 3. ICT index boost (normalised to a small adjustment) ---
    # ICT index for a top performer is ~150-200 over the season; a score
    # over 100 per game suggests elite threat, so we add a small bonus.
    ict_ppg = player.ict_index / max(games_played, 1) / 10.0
    base += min(ict_ppg * 0.1, 0.5)  # cap at 0.5pt adjustment

    # --- 4. xG and xA boost ---
    # Expected goals & assists capture underlying quality better than raw
    # totals for players on a short run of bad luck.
    xg_ppg = player.expected_goals / max(games_played, 1)
    xa_ppg = player.expected_assists / max(games_played, 1)
    xgi_adjustment = (
        xg_ppg * GOALS_POINTS[player.position_id] * 0.3
        + xa_ppg * ASSIST_POINTS * 0.3
    )
    base += xgi_adjustment

    # --- 5. Fixture difficulty adjustment ---
    fdr_multiplier = 1.0
    if fixture_window and fixture_window.difficulties:
        next_fdr = fixture_window.difficulties[0]
        fdr_multiplier = FDR_MULTIPLIER.get(next_fdr, 1.0)
        # Double gameweek: effectively double the expected return
        if fixture_window.double_gameweeks and (
            fixture_window.gameweeks
            and fixture_window.gameweeks[0] in fixture_window.double_gameweeks
        ):
            fdr_multiplier *= 1.9  # not quite 2× since minutes/fatigue

    predicted = base * fdr_multiplier

    # --- 6. Availability adjustment ---
    availability = _availability_chance(player)
    expected = predicted * availability

    return PlayerPrediction(
        player_id=player.id,
        web_name=player.web_name,
        position=player.position,
        cost=player.cost,
        predicted_points=round(predicted, 3),
        expected_points=round(expected, 3),
        availability_chance=availability,
        fixture_window=fixture_window,
    )


def predict_all(
    players: Sequence[Player],
    fixture_windows: dict[int, FixtureWindow] | None = None,
    games_played_map: dict[int, int] | None = None,
) -> list[PlayerPrediction]:
    """Predict expected points for all *players*.

    Parameters
    ----------
    players:
        Full player list.
    fixture_windows:
        Mapping of player_id → FixtureWindow.  Pass ``None`` to skip fixture
        adjustment.
    games_played_map:
        Mapping of player_id → games played this season.

    Returns a list sorted by descending expected points.
    """
    predictions: list[PlayerPrediction] = []
    for p in players:
        fw = (fixture_windows or {}).get(p.id)
        gp = (games_played_map or {}).get(p.id)
        predictions.append(predict_player(p, fixture_window=fw, games_played=gp))

    predictions.sort(key=lambda x: x.expected_points, reverse=True)
    return predictions
