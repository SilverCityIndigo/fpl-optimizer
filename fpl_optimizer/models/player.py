"""Data models for FPL players and teams.

These dataclasses provide a typed, easy-to-use representation of the raw
JSON returned by the FPL API.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# FPL position element-type IDs
POSITION_ID = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}
POSITION_NAME = {v: k for k, v in POSITION_ID.items()}

# FPL status codes
STATUS_AVAILABLE = "a"
STATUS_DOUBTFUL = "d"
STATUS_INJURED = "i"
STATUS_SUSPENDED = "s"
STATUS_UNAVAILABLE = "u"


@dataclass
class Team:
    """Represents a Premier League club."""

    id: int
    name: str
    short_name: str
    strength: int  # 1-5 overall team strength rating used by FPL

    @classmethod
    def from_api(cls, data: dict[str, Any]) -> "Team":
        return cls(
            id=data["id"],
            name=data["name"],
            short_name=data["short_name"],
            strength=data.get("strength", 3),
        )


@dataclass
class Fixture:
    """Represents a single FPL fixture."""

    id: int
    gameweek: int | None  # None if not yet scheduled
    home_team_id: int
    away_team_id: int
    home_team_difficulty: int  # FPL fixture difficulty rating 1-5
    away_team_difficulty: int
    finished: bool
    home_team_score: int | None
    away_team_score: int | None

    @classmethod
    def from_api(cls, data: dict[str, Any]) -> "Fixture":
        return cls(
            id=data["id"],
            gameweek=data.get("event"),
            home_team_id=data["team_h"],
            away_team_id=data["team_a"],
            home_team_difficulty=data.get("team_h_difficulty", 3),
            away_team_difficulty=data.get("team_a_difficulty", 3),
            finished=data.get("finished", False),
            home_team_score=data.get("team_h_score"),
            away_team_score=data.get("team_a_score"),
        )


@dataclass
class GameweekStats:
    """Per-gameweek performance statistics for a player."""

    gameweek: int
    total_points: int
    minutes: int
    goals_scored: int
    assists: int
    clean_sheets: int
    goals_conceded: int
    yellow_cards: int
    red_cards: int
    saves: int
    bonus: int
    bps: int  # bonus point system score
    selected: int  # number of FPL managers who selected the player
    transfers_in: int
    transfers_out: int
    value: int  # player value in tenths of millions (e.g. 65 = £6.5m)

    @classmethod
    def from_api(cls, data: dict[str, Any]) -> "GameweekStats":
        return cls(
            gameweek=data["round"],
            total_points=data["total_points"],
            minutes=data["minutes"],
            goals_scored=data["goals_scored"],
            assists=data["assists"],
            clean_sheets=data["clean_sheets"],
            goals_conceded=data["goals_conceded"],
            yellow_cards=data["yellow_cards"],
            red_cards=data["red_cards"],
            saves=data["saves"],
            bonus=data["bonus"],
            bps=data["bps"],
            selected=data.get("selected", 0),
            transfers_in=data.get("transfers_in", 0),
            transfers_out=data.get("transfers_out", 0),
            value=data.get("value", 0),
        )


@dataclass
class Player:
    """Represents an FPL player with their current season stats."""

    id: int
    first_name: str
    second_name: str
    web_name: str  # Display name used in FPL (typically surname)
    team_id: int
    position_id: int  # 1=GKP, 2=DEF, 3=MID, 4=FWD
    now_cost: int  # Cost in tenths of millions (e.g. 65 = £6.5m)
    total_points: int
    form: float  # Average points per game over last 30 days
    points_per_game: float
    selected_by_percent: float
    status: str  # 'a'=available, 'd'=doubtful, 'i'=injured, 's'=suspended
    chance_of_playing_next_round: int | None  # 0-100
    minutes: int
    goals_scored: int
    assists: int
    clean_sheets: int
    goals_conceded: int
    yellow_cards: int
    red_cards: int
    saves: int
    bonus: int
    bps: int
    influence: float  # Opta influence score
    creativity: float  # Opta creativity score
    threat: float  # Opta threat score
    ict_index: float  # Influence + Creativity + Threat composite
    expected_goals: float  # xG for the season
    expected_assists: float  # xA for the season
    expected_goal_involvements: float  # xGI = xG + xA
    expected_goals_conceded: float  # xGC for the season (defenders/GKs)
    transfers_in_event: int  # Transfers in for current gameweek
    transfers_out_event: int
    gameweek_history: list[GameweekStats] = field(default_factory=list)

    @classmethod
    def from_api(cls, data: dict[str, Any]) -> "Player":
        return cls(
            id=data["id"],
            first_name=data["first_name"],
            second_name=data["second_name"],
            web_name=data["web_name"],
            team_id=data["team"],
            position_id=data["element_type"],
            now_cost=data["now_cost"],
            total_points=data["total_points"],
            form=float(data.get("form", 0) or 0),
            points_per_game=float(data.get("points_per_game", 0) or 0),
            selected_by_percent=float(data.get("selected_by_percent", 0) or 0),
            status=data.get("status", STATUS_AVAILABLE),
            chance_of_playing_next_round=data.get("chance_of_playing_next_round"),
            minutes=data.get("minutes", 0),
            goals_scored=data.get("goals_scored", 0),
            assists=data.get("assists", 0),
            clean_sheets=data.get("clean_sheets", 0),
            goals_conceded=data.get("goals_conceded", 0),
            yellow_cards=data.get("yellow_cards", 0),
            red_cards=data.get("red_cards", 0),
            saves=data.get("saves", 0),
            bonus=data.get("bonus", 0),
            bps=data.get("bps", 0),
            influence=float(data.get("influence", 0) or 0),
            creativity=float(data.get("creativity", 0) or 0),
            threat=float(data.get("threat", 0) or 0),
            ict_index=float(data.get("ict_index", 0) or 0),
            expected_goals=float(data.get("expected_goals", 0) or 0),
            expected_assists=float(data.get("expected_assists", 0) or 0),
            expected_goal_involvements=float(
                data.get("expected_goal_involvements", 0) or 0
            ),
            expected_goals_conceded=float(
                data.get("expected_goals_conceded", 0) or 0
            ),
            transfers_in_event=data.get("transfers_in_event", 0),
            transfers_out_event=data.get("transfers_out_event", 0),
        )

    @property
    def position(self) -> str:
        """Return the 3-letter position abbreviation (GKP/DEF/MID/FWD)."""
        return POSITION_ID.get(self.position_id, "UNK")

    @property
    def cost(self) -> float:
        """Return the player cost in millions (e.g. 6.5)."""
        return self.now_cost / 10.0

    @property
    def is_available(self) -> bool:
        """True if the player has no injury/suspension preventing selection."""
        if self.status in (STATUS_INJURED, STATUS_SUSPENDED, STATUS_UNAVAILABLE):
            return False
        if self.chance_of_playing_next_round is not None:
            return self.chance_of_playing_next_round > 0
        return True

    def display(self) -> str:
        """Return a short, readable summary of the player."""
        return (
            f"{self.web_name} ({self.position}, £{self.cost:.1f}m) "
            f"– {self.total_points}pts | form {self.form:.1f}"
        )
