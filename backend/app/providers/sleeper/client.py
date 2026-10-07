"""
Raw HTTP client for Sleeper's free, keyless player API — the app's
source of NFL player identity (name/position/team/status), replacing
ESPN's private fantasy API for that purpose (see the project plan: a
single shared ESPN session can't act on every owner's behalf, so
draft/roster/lineup management is moving off it entirely).

Sleeper's docs (docs.sleeper.com) are explicit that /v1/players/nfl is a
~5MB payload meant to be fetched **at most once per day** and cached —
this module is deliberately a single unauthenticated GET with no
per-request usage anywhere in the app; only app/providers/sleeper/ingest.py
(via the daily scheduler job or a manual admin trigger) ever calls it.
Never call fetch_all_players() from a request handler.
"""
import requests

_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"
_TIMEOUT_SECONDS = 30


_SEASON_STATS_URL = "https://api.sleeper.app/v1/stats/nfl/regular/{season}"


def fetch_players_who_played(seasons: list[int]) -> set[str]:
    """Sleeper ids of every player with at least one game played (gp > 0)
    in any of these regular seasons — how an unsigned free agent (no
    team) is told apart from a long-retired player Sleeper still lists
    as Active (2026-10). Same once-a-day ingest as fetch_all_players."""
    played: set[str] = set()
    for season in seasons:
        response = requests.get(_SEASON_STATS_URL.format(season=season), timeout=_TIMEOUT_SECONDS)
        response.raise_for_status()
        played.update(sid for sid, stats in (response.json() or {}).items() if (stats or {}).get("gp"))
    return played


def fetch_all_players() -> dict:
    """Returns Sleeper's raw player map: {sleeper_player_id: {...fields}}.
    Covers the full NFL player universe (active, inactive, practice
    squad, free agents) — filtering down to a clean draftable pool
    happens in ingest.py, not here."""
    response = requests.get(_PLAYERS_URL, timeout=_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()
