"""Fetch and cache data from the official FPL REST API.

The FPL API is publicly available with no authentication required:
  https://fantasy.premierleague.com/api/bootstrap-static/
  https://fantasy.premierleague.com/api/fixtures/
  https://fantasy.premierleague.com/api/element-summary/{player_id}/
"""

from __future__ import annotations

import time
from typing import Any

import requests

BASE_URL = "https://fantasy.premierleague.com/api"

# A browser-like User-Agent avoids 403 responses from the FPL CDN.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; fpl-optimizer/0.1; "
        "+https://github.com/SilverCityIndigo/fpl-optimizer)"
    )
}

# Simple in-memory cache: {url: (timestamp, data)}
_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_TTL = 300  # seconds


def _get(url: str, timeout: int = 15) -> Any:
    """GET *url*, using a short TTL in-memory cache to avoid hammering the API."""
    now = time.monotonic()
    if url in _CACHE:
        ts, data = _CACHE[url]
        if now - ts < _CACHE_TTL:
            return data

    resp = requests.get(url, headers=_HEADERS, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    _CACHE[url] = (now, data)
    return data


def get_bootstrap() -> dict[str, Any]:
    """Return the FPL bootstrap-static payload.

    This contains the full player list, team list, position types and
    current gameweek information for the season.
    """
    return _get(f"{BASE_URL}/bootstrap-static/")


def get_fixtures(gameweek: int | None = None) -> list[dict[str, Any]]:
    """Return fixtures.

    Parameters
    ----------
    gameweek:
        If provided, return only fixtures for that gameweek.
        If ``None``, return all fixtures for the season.
    """
    if gameweek is not None:
        return _get(f"{BASE_URL}/fixtures/?event={gameweek}")
    return _get(f"{BASE_URL}/fixtures/")


def get_player_history(player_id: int) -> dict[str, Any]:
    """Return detailed history for a single player.

    The payload contains:
      - ``history``       – per-gameweek stats for the current season
      - ``history_past``  – per-season stats for past seasons
      - ``fixtures``      – upcoming fixture list
    """
    return _get(f"{BASE_URL}/element-summary/{player_id}/")


def clear_cache() -> None:
    """Clear the in-memory response cache (useful for tests or long-running processes)."""
    _CACHE.clear()
