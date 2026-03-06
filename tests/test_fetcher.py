"""Tests for the FPL API data fetcher."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from fpl_optimizer.data import fetcher


@pytest.fixture(autouse=True)
def clear_cache():
    """Ensure the in-memory cache is empty before every test."""
    fetcher.clear_cache()
    yield
    fetcher.clear_cache()


def _mock_response(payload):
    resp = MagicMock()
    resp.json.return_value = payload
    resp.raise_for_status = MagicMock()
    return resp


def test_get_bootstrap_calls_correct_url():
    payload = {"elements": [], "teams": [], "events": []}
    with patch("requests.get", return_value=_mock_response(payload)) as mock_get:
        result = fetcher.get_bootstrap()
    mock_get.assert_called_once()
    url = mock_get.call_args[0][0]
    assert "bootstrap-static" in url
    assert result == payload


def test_get_bootstrap_uses_cache():
    payload = {"elements": [], "teams": [], "events": []}
    with patch("requests.get", return_value=_mock_response(payload)) as mock_get:
        fetcher.get_bootstrap()
        fetcher.get_bootstrap()
    # Should only call the API once due to caching
    assert mock_get.call_count == 1


def test_get_fixtures_without_gameweek():
    payload = [{"id": 1, "event": 1}]
    with patch("requests.get", return_value=_mock_response(payload)) as mock_get:
        result = fetcher.get_fixtures()
    url = mock_get.call_args[0][0]
    assert "fixtures" in url
    assert "event=" not in url
    assert result == payload


def test_get_fixtures_with_gameweek():
    payload = [{"id": 1, "event": 5}]
    with patch("requests.get", return_value=_mock_response(payload)) as mock_get:
        result = fetcher.get_fixtures(gameweek=5)
    url = mock_get.call_args[0][0]
    assert "event=5" in url
    assert result == payload


def test_get_player_history():
    payload = {"history": [], "history_past": [], "fixtures": []}
    with patch("requests.get", return_value=_mock_response(payload)) as mock_get:
        result = fetcher.get_player_history(42)
    url = mock_get.call_args[0][0]
    assert "element-summary/42" in url
    assert result == payload


def test_clear_cache():
    payload = {"elements": []}
    with patch("requests.get", return_value=_mock_response(payload)):
        fetcher.get_bootstrap()
    fetcher.clear_cache()
    with patch("requests.get", return_value=_mock_response(payload)) as mock_get2:
        fetcher.get_bootstrap()
    assert mock_get2.call_count == 1


def test_get_raises_on_http_error():
    resp = MagicMock()
    resp.raise_for_status.side_effect = Exception("404")
    with patch("requests.get", return_value=resp):
        with pytest.raises(Exception, match="404"):
            fetcher.get_bootstrap()
