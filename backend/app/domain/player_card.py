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
(nothing to show pre-season), oldest week first (a game log reads
top-to-bottom through the season, not most-recent-first). latest_week
mirrors weekly_scores[-1] for any caller that only ever wanted the most
recent week. Each weekly row's `opponent` is resolved the same way
app/domain/nfl_schedule.py's schedule_lookup_by_pro_team already
resolves "next opponent" elsewhere in this app, just re-run for that
historical week's real scoreboard instead of the current one — there's
no persisted schedule table, but app/domain/bye_weeks.py already proves
this same public scoreboard endpoint answers correctly for any past
week, not just "right now".

Three independently-sourced pieces, deliberately kept that way:
Sleeper's half is always real DB data the caller already paid for (no
network call at request time) and is always returned even if ESPN is
unreachable; both ESPN pieces degrade to None on any failure — a bad
crosswalk id, a timeout, ESPN being down — rather than raising, since
they're enrichment on top of a real player record, not the record
itself. A DEF entry (2026-10-12) gets ESPN's projection/ownership —
its espn_player_id is ESPN's own D/ST id (-16000 minus the team id),
which player_info resolves fine — but no athlete overview or ESPN game
log (D/STs have no athlete page). Its game log is built from our own
weekly stats instead (_defense_game_log), and its picture is the team
logo.
"""
import asyncio
import json
import logging

from app.config import DEFAULT_LEAGUE_ID
from app.domain.nfl_schedule import schedule_lookup_by_pro_team
from app.providers.espn.player_info import get_player_info
from app.providers.espn.player_game_log import get_player_game_log
from app.providers.espn.player_overview import get_player_overview
from app.providers.nfl_scoreboard import get_week_scoreboard

logger = logging.getLogger(__name__)

# Sleeper's own free, keyless headshot CDN — same id space as
# players.sleeper_player_id, no separate image-hosting concern for
# this app. DEF entries have no real headshot (Sleeper keys them by
# team abbreviation, not a person) — the frontend falls back to a team
# badge/initials for those, same as it already does elsewhere.
SLEEPER_HEADSHOT_URL = "https://sleepercdn.com/content/nfl/players/{player_id}.jpg"
# A D/ST's picture: its team logo, the same ESPN CDN image the web's
# teamLogoUrl (frontend/src/lib/nfl-teams.ts) uses.
TEAM_LOGO_URL = "https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/{abbr}.png&w=160&h=160"

# A D/ST's game log columns, from the stats our scoring already stores
# for it (app/providers/nfl_stats/espn_public.py). Points allowed is the
# real final score; yards allowed is only stored as its scoring band.
_DEFENSE_COUNTS = [("SACK", "def_sack"), ("INT", "def_int"), ("FR", "def_fum_rec"),
                   ("SFTY", "def_safety"), ("BLK", "def_block"), ("TD", "def_return_td")]


def _count(value) -> str:
    number = float(value or 0)
    return str(int(number)) if number.is_integer() else f"{number:.1f}"


def _yards_allowed_band(raw: dict) -> str:
    for key in raw:
        if key.startswith("yds_allow_"):
            band = key.removeprefix("yds_allow_")
            if band.startswith("lt"):
                return f"<{band[2:]}"
            if band.endswith("_plus"):
                return f"{band.removesuffix('_plus')}+"
            return band.replace("_", "–")
    return "—"


def _defense_game_log(pro_team: str, rows: list[dict], games_by_week: dict[int, dict]) -> dict | None:
    """The same {"categories", "games"} shape as ESPN's athlete game log
    (app/providers/espn/player_game_log.py), so every client's game-log
    table renders a D/ST without a special case."""
    games = []
    for row in rows:
        raw = row["raw_stats"]
        if isinstance(raw, str):
            raw = json.loads(raw)
        raw = raw or {}
        game = games_by_week.get(row["week"]) or {}
        home = game.get("home_team") == pro_team
        opponent = game.get("away_team") if home else game.get("home_team")
        mine, theirs = (game.get("home_score"), game.get("away_score")) if home else (game.get("away_score"), game.get("home_score"))
        result = None
        points_allowed = "—"
        if theirs not in (None, "") and mine not in (None, ""):
            points_allowed = str(theirs)
            if game.get("completed"):
                mine_n, theirs_n = float(mine), float(theirs)
                outcome = "W" if mine_n > theirs_n else "L" if mine_n < theirs_n else "T"
                result = f"{outcome} {mine}-{theirs}"
        games.append({
            "week": row["week"],
            "opponent": (opponent if home else f"@{opponent}") if opponent else None,
            "result": result,
            "stats": {"defense": [_count(raw.get(key)) for _, key in _DEFENSE_COUNTS]
                      + [points_allowed, _yards_allowed_band(raw)]},
        })
    if not games:
        return None
    labels = [label for label, _ in _DEFENSE_COUNTS] + ["PA", "YA"]
    return {"categories": [{"key": "defense", "title": "Defense", "labels": labels}], "games": games}


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
    is_defense = card["position"] == "DEF"
    if is_defense:
        card["headshot_url"] = TEAM_LOGO_URL.format(abbr=card["pro_team"].lower()) if card["pro_team"] else None
    else:
        card["headshot_url"] = SLEEPER_HEADSHOT_URL.format(player_id=sleeper_player_id)
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
    # Listed by their owner as someone they'd trade (Trades' trade block).
    card["on_trade_block"] = False
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
            card["on_trade_block"] = bool(await conn.fetchval(
                "SELECT 1 FROM trade_block WHERE team_id = $1 AND sleeper_player_id = $2",
                roster_row["team_id"], sleeper_player_id,
            ))

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

    if card["espn_player_id"] is not None and not is_defense:
        try:
            card["overview"] = await get_player_overview(card["espn_player_id"])
        except Exception:
            logger.exception(
                "ESPN player_overview lookup failed for sleeper_player_id=%s espn_player_id=%s",
                sleeper_player_id, card["espn_player_id"],
            )

    # This season only (2026-10): every season's rows used to mix into one log.
    weekly_rows = await conn.fetch(
        "SELECT week, fantasy_points, raw_stats FROM player_week_stats "
        "WHERE sleeper_player_id = $1 AND league_id = $2 AND ($3::int IS NULL OR season = $3) ORDER BY week ASC",
        sleeper_player_id, league_id, season,
    )
    weekly_scores = [{"week": r["week"], "fantasy_points": r["fantasy_points"]} for r in weekly_rows]

    opponent_by_week: dict[int, str | None] = {}
    games_by_week: dict[int, dict] = {}
    if season is not None and weekly_scores:
        weeks = sorted({r["week"] for r in weekly_scores})

        async def _opponent_for_week(week: int) -> tuple[int, str | None, dict | None]:
            try:
                games = await get_week_scoreboard(week, season)
                lookup = schedule_lookup_by_pro_team(games)
                game = next((g for g in games if card["pro_team"] in (g.get("home_team"), g.get("away_team"))), None)
                return week, lookup.get(card["pro_team"], {}).get("next_opponent"), game
            except Exception:
                logger.exception(
                    "get_week_scoreboard failed for season=%s week=%s (player card opponent lookup)",
                    season, week,
                )
                return week, None, None

        for week, opponent, game in await asyncio.gather(*(_opponent_for_week(w) for w in weeks)):
            opponent_by_week[week] = opponent
            if game is not None:
                games_by_week[week] = game

    for r in weekly_scores:
        r["opponent"] = opponent_by_week.get(r["week"])

    card["weekly_scores"] = weekly_scores

    # The ESPN-style game log (2026-10): each game's box-score line by
    # category, with our fantasy points for that week beside it.
    card["game_log"] = None
    if is_defense and card["pro_team"]:
        game_log = _defense_game_log(card["pro_team"], [dict(r) for r in weekly_rows], games_by_week)
        if game_log:
            points = {r["week"]: r["fantasy_points"] for r in weekly_scores}
            for game in game_log["games"]:
                game["fantasy_points"] = points.get(game["week"])
            card["game_log"] = game_log
    elif card.get("espn_player_id") is not None and season is not None:
        try:
            game_log = await get_player_game_log(card["espn_player_id"], season)
        except Exception:
            logger.warning("ESPN game log lookup failed for espn_player_id=%s", card["espn_player_id"], exc_info=True)
            game_log = None
        if game_log:
            points = {r["week"]: r["fantasy_points"] for r in weekly_scores}
            for game in game_log["games"]:
                game["fantasy_points"] = points.get(game["week"])
            card["game_log"] = game_log
    card["latest_week"] = (
        {"week": weekly_scores[-1]["week"], "fantasy_points": weekly_scores[-1]["fantasy_points"]}
        if weekly_scores else None
    )

    return card
