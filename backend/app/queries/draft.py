"""Read-only queries for the draft (app/routers/draft.py) — mirrors
app/queries/keepers.py's split (plain reads live here, the actual
pick/turn mutations live in app/domain/draft_engine.py)."""
import json

from app.config import DEFAULT_LEAGUE_ID


async def get_draft_pool(
    conn, season: int, position: str | None = None, search: str | None = None, league_id: int = DEFAULT_LEAGUE_ID
):
    # projected_points: a bulk ESPN sync (app/domain/player_projections.py),
    # best-effort — null where the crosswalk to ESPN's own id never
    # resolved. bye_week: NOT sourced from ESPN at all — a per-team (not
    # per-player) join against team_bye_weeks, the same real, already-
    # populated source app/domain/bye_weeks.py maintains independently
    # of any per-player ESPN lookup. search_rank doubles as this app's
    # ADP-equivalent (see draft_autopick.py's own docstring) — no new
    # column for that.
    query = """
        SELECT p.sleeper_player_id, p.full_name, p.position, p.pro_team, p.search_rank, p.injury_status,
               p.projected_points, tbw.bye_week,
               dp.pick_number IS NOT NULL AS drafted
        FROM players p
        LEFT JOIN draft_picks dp ON dp.sleeper_player_id = p.sleeper_player_id
            AND dp.season = $1 AND dp.league_id = $2
        LEFT JOIN team_bye_weeks tbw ON tbw.season = $1 AND tbw.pro_team = p.pro_team
        WHERE p.is_draftable
    """
    params = [season, league_id]
    if position:
        query += f" AND p.position = ${len(params) + 1}"
        params.append(position)
    if search:
        query += f" AND p.full_name ILIKE ${len(params) + 1}"
        params.append(f"%{search}%")
    query += " ORDER BY drafted ASC, p.search_rank ASC NULLS LAST, p.full_name ASC"
    return await conn.fetch(query, *params)


async def get_draft_state(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    config = await conn.fetchrow(
        "SELECT * FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
    )
    if config is None:
        return None
    config_dict = dict(config)
    if isinstance(config_dict.get("roster_slots"), str):
        config_dict["roster_slots"] = json.loads(config_dict["roster_slots"])

    picks = await conn.fetch(
        """
        SELECT dp.pick_number, dp.round, dp.round_pick, dp.owner_id, o.display_name AS owner_name,
               dp.sleeper_player_id, p.full_name AS player_name, p.position AS player_position,
               dp.is_autopick, dp.is_keeper, dp.made_at
        FROM draft_picks dp
        JOIN owners o ON o.owner_id = dp.owner_id
        LEFT JOIN players p ON p.sleeper_player_id = dp.sleeper_player_id
        WHERE dp.season = $1 AND dp.league_id = $2
        ORDER BY dp.pick_number
        """,
        season, league_id,
    )
    return {"config": config_dict, "picks": [dict(p) for p in picks]}


async def get_team_roster_positions(conn, season: int, team_id: int) -> list[str]:
    rows = await conn.fetch(
        "SELECT p.position FROM current_rosters cr JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id "
        "WHERE cr.season = $1 AND cr.team_id = $2",
        season, team_id,
    )
    return [r["position"] for r in rows]


async def get_schedule_only(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    """A pre-set draft time that doesn't have a real draft_config row
    to live on yet — see league_draft_schedule's own migration
    docstring. None if nothing's been set this way (including once a
    real draft exists and create_draft has already moved it over)."""
    return await conn.fetchval(
        "SELECT scheduled_start FROM league_draft_schedule WHERE season = $1 AND league_id = $2", season, league_id
    )


async def get_effective_scheduled_start(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    """The real draft time, whichever of the two possible homes it's
    currently in — draft_config.scheduled_start once a real draft
    exists (the single source of truth every other reader already
    uses), or league_draft_schedule when a commissioner has set a time
    ahead of deciding the draft order. Returns None if neither has one
    set."""
    from_config = await conn.fetchval(
        "SELECT scheduled_start FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
    )
    if from_config is not None:
        return from_config
    return await get_schedule_only(conn, season, league_id)
