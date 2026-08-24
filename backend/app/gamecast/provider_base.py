"""
Common interface every live NFL data provider implements — the seam
between whichever commercial feed is configured (Sportradar, a future
alternative) and the rest of the app. Everything above this layer (the
live-game service in service.py, the WS broadcaster in manager.py, the
Gamecast UI) talks only to the normalized LiveGame/LiveGameSummary
models (see models.py) and never touches a provider's own response
shape directly. Swapping providers — or falling back to the mock
simulation when no real API key is configured — is the one-line change
in providers/__init__.py's factory function; nothing else needs to
know or care which provider is actually running.

Same shape as app/providers/base.py's FantasyProvider ABC (ESPN sync),
kept as a separate hierarchy on purpose: that one is about syncing a
fantasy *platform's* rosters/matchups, this one is about live NFL
*game* state — different providers, different data, no shared parent.
"""
from abc import ABC, abstractmethod

from app.gamecast.models import LiveGame, LiveGameSummary


class NFLDataProvider(ABC):
    @abstractmethod
    async def list_live_games(self) -> list[LiveGameSummary]:
        """Every game currently live (or about to be) — lightweight, for
        the ticker and game discovery. No play-by-play; call
        get_game_state for that."""

    @abstractmethod
    async def get_game_state(self, game_id: str) -> LiveGame:
        """Full current state for one game — score, quarter/clock,
        possession, down/distance, drives, plays, scoring plays. This
        is what the Gamecast UI actually renders."""
