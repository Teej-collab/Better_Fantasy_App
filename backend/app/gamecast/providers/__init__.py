"""
Selects the live NFL data provider once per process — Sportradar if
SPORTRADAR_API_KEY is configured, the mock simulation otherwise. This
is the one place in the app that knows which provider is running;
everything else (service.py, the router, the frontend) only ever sees
the normalized NFLDataProvider interface. A cached singleton, not a
fresh instance per call: MockNFLDataProvider holds its simulated
game-in-progress state in memory, so a new instance would reset every
mock game back to kickoff on every request.
"""
import os

from app.gamecast.provider_base import NFLDataProvider

_provider: NFLDataProvider | None = None


def get_nfl_data_provider() -> NFLDataProvider:
    global _provider
    if _provider is None:
        if os.getenv("SPORTRADAR_API_KEY"):
            from app.gamecast.providers.sportradar import SportradarProvider

            _provider = SportradarProvider()
        else:
            from app.gamecast.providers.mock import MockNFLDataProvider

            _provider = MockNFLDataProvider()
    return _provider
