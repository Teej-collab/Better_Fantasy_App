"""
ESPN-specific config, loaded lazily (only when ESPNProvider is
instantiated) rather than at process startup like app/config.py's core
settings. This means a developer who isn't touching ESPN sync doesn't
need real ESPN cookies just to run the backend — the app only fails
loudly the moment something actually tries to talk to ESPN.
"""
import os

from app.config import _require


class ESPNConfig:
    def __init__(self):
        self.league_id = int(_require("ESPN_LEAGUE_ID"))
        self.espn_s2 = _require("ESPN_S2")
        self.swid = _require("ESPN_SWID")
        self.active_season = int(_require("ACTIVE_SEASON"))
        self.league_start_season = int(
            os.getenv("LEAGUE_START_SEASON", str(self.active_season))
        )
        # Defaults to True (safe by default): the lineup mutation layer
        # (app/providers/espn/lineup_client.py) refuses to send a real
        # write request until this is explicitly set to false AND the
        # write endpoint has been verified — see ESPN_LINEUP_WRITE.md.
        # Anything other than exactly "false" (case-insensitive) is dry-run.
        self.dry_run = os.getenv("ESPN_DRY_RUN", "true").strip().lower() != "false"
