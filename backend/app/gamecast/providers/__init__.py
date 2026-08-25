"""
Selects the live NFL data provider once per process. This is the one
place in the app that knows which provider is running; everything else
(service.py, the router, the frontend) only ever sees the normalized
NFLDataProvider interface. A cached singleton, not a fresh instance per
call — MockNFLDataProvider holds its simulated game-in-progress state
in memory, so a new instance would reset every mock game back to
kickoff on every request.

Priority:
1. Sportradar, if SPORTRADAR_API_KEY is configured — the real
   commercial feed this was always meant to run on eventually.
2. ESPN's public scoreboard/summary API otherwise (providers/espn.py)
   — real games with real stats, no API key required. This is the
   default now: every real NFL game, live or already final, gets a
   working Gamecast, which is the whole point of linking a ticker item
   to one. Set GAMECAST_PROVIDER=mock to force the old fixed
   simulation instead (useful for local development against a fast,
   deterministic, always-in-progress game with no network dependency).
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
        elif os.getenv("GAMECAST_PROVIDER", "").lower() == "mock":
            from app.gamecast.providers.mock import MockNFLDataProvider

            _provider = MockNFLDataProvider()
        else:
            from app.gamecast.providers.espn import ESPNNFLDataProvider

            _provider = ESPNNFLDataProvider()
    return _provider
