"""
Composes a single player's card for the player-card UI (click a name
in the draft pool/roster/free agents to see it): Sleeper's bio
(headshot, age/height/weight/jersey/exp — see app/providers/sleeper/
ingest.py) plus ESPN's real season/weekly point projections,
ownership%, and bye week/next opponent (app/providers/espn/
player_info.py), plus ESPN's public athlete-overview data — recent
news, a RotoWire beat-writer note, real draft/position rank, and a
prose season outlook (app/providers/espn/player_overview.py) — plus
this app's own real computed scores for every week the scoring engine
has run for this player (app/domain/weekly_stats.py), an empty list
until Phase D/F's weekly compute has actually run for a real week
(nothing to show pre-season). latest_week mirrors weekly_scores[0] for
any caller that only ever wanted the most recent week.

Three independently-sourced pieces, deliberately kept that way:
Sleeper's half is always real DB data the caller already paid for (no
network call at request time) and is always returned even if ESPN is
unreachable; both ESPN pieces degrade to None on any failure — a bad
crosswalk id, a timeout, ESPN being down — rather than raising, since
they're enrichment on top of a real player record, not the record
itself. A DEF entry gets neither: ESPN's player_map (see
player_info.py) is a name->id map of individual NFL athletes, not team
D/ST units, so there's no id to resolve either lookup with anyway.
"""
import logging

from app.config import DEFAULT_LEAGUE_ID
from app.providers.espn.player_info import get_player_info
from app.providers.espn.player_overview import get_player_overview

logger = logging.getLogger(__name__)

# Sleeper's own free, keyless headshot CDN — same id space as
# players.sleeper_player_id, no separate image-hosting concern for
# this app. DEF entries have no real headshot (Sleeper keys them by
# team abbreviation, not a person) — the frontend falls back to a team
# badge/initials for those, same as it already does elsewhere.
SLEEPER_HEADSHOT_URL = "https://sleepercdn.com/content/nfl/players/{player_id}.jpg"


async def get_player_card(
    conn, sleeper_player_id: str, league_id: int = DEFAULT_LEAGUE_ID,
    season: int | None = None, my_owner_id: int | None = None,
) -> dict | None:
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
    card["overview"] = None

    # Who currently rosters this player this season, if anyone —
    # 2026-09-18 addition: the player card is the one place ESPN's own
    # reference puts "Drop"/"Trade Offers" (reachable straight from
    # tapping a player, not a separate roster-row action), and both
    # only make sense with real ownership context: Drop only for a
    # player on the CALLER's own team, Trade Offers for any rostered
    # player (yours or an opponent's you might want). `season`/
    # `my_owner_id` are optional so every existing caller (draft pool,
    # free agents, player research) that doesn't have real league/
    # season context yet keeps working unchanged, just without this.
    card["rostered_team_id"] = None
    card["rostered_team_name"] = None
    card["is_on_my_team"] = False
    if season is not None:
        roster_row = await conn.fetchrow(
            """
            SELECT t.id AS team_id, t.team_name, t.owner_id
            FROM current_rosters cr
            JOIN teams_by_season t ON t.id = cr.team_id
            WHERE cr.season = $1 AND cr.league_id = $2 AND cr.sleeper_player_id = $3
            """,
            season, league_id, sleeper_player_id,
        )
        if roster_row is not None:
            card["rostered_team_id"] = roster_row["team_id"]
            card["rostered_team_name"] = roster_row["team_name"]
            card["is_on_my_team"] = my_owner_id is not None and roster_row["owner_id"] == my_owner_id

    if card["position"] != "DEF":
        try:
            projection = get_player_info(card["espn_player_id"], full_name=card["full_name"])
        except Exception:
            projection = None
            logger.exception(
                "ESPN player_info lookup failed for sleeper_player_id=%s espn_player_id=%s",
                sleeper_player_id, card["espn_player_id"],
            )
        card["projection"] = projection

        # A resolved-by-name id that wasn't already on the row — persist
        # it so the next lookup (and Phase D's weekly-stats crosswalk,
        # which reads this same column) skips name-matching entirely.
        # See player_info.py's docstring for the (rare, accepted) risk
        # of a same-name mismatch.
        if projection is not None and card["espn_player_id"] is None:
            resolved_id = projection["espn_player_id"]
            await conn.execute(
                "UPDATE players SET espn_player_id = $1 WHERE sleeper_player_id = $2",
                resolved_id, sleeper_player_id,
            )
            card["espn_player_id"] = resolved_id

        if card["espn_player_id"] is not None:
            try:
                card["overview"] = await get_player_overview(card["espn_player_id"])
            except Exception:
                logger.exception(
                    "ESPN player_overview lookup failed for sleeper_player_id=%s espn_player_id=%s",
                    sleeper_player_id, card["espn_player_id"],
                )

    weekly_rows = await conn.fetch(
        "SELECT week, fantasy_points FROM player_week_stats "
        "WHERE sleeper_player_id = $1 AND league_id = $2 ORDER BY week DESC",
        sleeper_player_id, league_id,
    )
    card["weekly_scores"] = [dict(r) for r in weekly_rows]
    card["latest_week"] = dict(weekly_rows[0]) if weekly_rows else None

    return card
