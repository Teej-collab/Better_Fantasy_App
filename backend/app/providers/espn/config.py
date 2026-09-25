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
    def __init__(
        self, *, league_id: int | None = None, espn_s2: str | None = None,
        swid: str | None = None, active_season: int | None = None,
    ):
        """Every param defaults to the global env vars, unchanged from
        before — every existing call site (`ESPNConfig()`, no args)
        keeps reading League #1's real credentials exactly as it always
        has. The overrides exist for a per-league ESPN connection
        (app/queries/league_espn_connections.py, Phase 6 of the
        multi-league migration — see TODO.md's PHASE 9 entry): the
        decrypted espn_s2/swid for a league OTHER than League #1 have
        nowhere to live as env vars, so they're passed in directly
        instead. league_start_season still isn't override-able — a
        connected league's first real historical season isn't knowable
        from anything this app has today, so a per-league manual sync
        only ever targets active_season (see app/routers/
        league_settings.py's sync endpoint), never a historical
        backfill range."""
        self.league_id = league_id if league_id is not None else int(_require("ESPN_LEAGUE_ID"))
        self.espn_s2 = espn_s2 if espn_s2 is not None else _require("ESPN_S2")
        self.swid = swid if swid is not None else _require("ESPN_SWID")
        self.active_season = active_season if active_season is not None else int(_require("ACTIVE_SEASON"))
        self.league_start_season = int(
            os.getenv("LEAGUE_START_SEASON", str(self.active_season))
        )
        # Defaults to True (safe by default): the lineup mutation layer
        # (app/providers/espn/lineup_client.py) refuses to send a real
        # write request until this is explicitly set to false AND the
        # write endpoint has been verified — see ESPN_LINEUP_WRITE.md.
        # Anything other than exactly "false" (case-insensitive) is dry-run.
        self.dry_run = os.getenv("ESPN_DRY_RUN", "true").strip().lower() != "false"
