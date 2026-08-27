"""
Composes a single player's card for the player-card UI (click a name
in the draft pool/roster/free agents to see it): Sleeper's bio
(headshot, age/height/weight/jersey/exp — see app/providers/sleeper/
ingest.py) plus ESPN's real season/weekly point projections,
ownership%, and bye week/next opponent (app/providers/espn/
player_info.py).

Two independently-sourced halves, deliberately kept that way: Sleeper's
half is always real DB data the caller already paid for (no network
call at request time) and is always returned even if ESPN is
unreachable; ESPN's half degrades to None on any failure — a bad
crosswalk id, a timeout, ESPN being down — rather than raising, since
this is enrichment on top of a real player record, not the record
itself. A DEF entry gets no ESPN enrichment at all: Sleeper's
crosswalk only carries real espn_player_id values for individual
players, not team D/ST units.
"""
import logging

from app.providers.espn.player_info import get_player_info

logger = logging.getLogger(__name__)

# Sleeper's own free, keyless headshot CDN — same id space as
# players.sleeper_player_id, no separate image-hosting concern for
# this app. DEF entries have no real headshot (Sleeper keys them by
# team abbreviation, not a person) — the frontend falls back to a team
# badge/initials for those, same as it already does elsewhere.
SLEEPER_HEADSHOT_URL = "https://sleepercdn.com/content/nfl/players/{player_id}.jpg"


async def get_player_card(conn, sleeper_player_id: str) -> dict | None:
    row = await conn.fetchrow(
        """
        SELECT sleeper_player_id, espn_player_id, full_name, position, pro_team,
               status, injury_status, age, height, weight, jersey_number, years_exp
        FROM players WHERE sleeper_player_id = $1
        """,
        sleeper_player_id,
    )
    if row is None:
        return None

    card = dict(row)
    card["headshot_url"] = (
        None if card["position"] == "DEF" else SLEEPER_HEADSHOT_URL.format(player_id=sleeper_player_id)
    )
    card["projection"] = None

    if card["espn_player_id"] is not None:
        try:
            card["projection"] = get_player_info(card["espn_player_id"])
        except Exception:
            logger.exception(
                "ESPN player_info lookup failed for sleeper_player_id=%s espn_player_id=%s",
                sleeper_player_id, card["espn_player_id"],
            )

    return card
