"""Read-only queries for the draft (app/routers/draft.py) — mirrors
app/queries/keepers.py's split (plain reads live here, the actual
pick/turn mutations live in app/domain/draft_engine.py)."""
import json

from app.config import DEFAULT_LEAGUE_ID
from app.domain.roster_slots import DEFAULT_ROSTER_SLOTS


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
    if isinstance(config_dict.get("position_max"), str):
        config_dict["position_max"] = json.loads(config_dict["position_max"])

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


async def get_roster_slots_setting(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    """A pre-set roster shape staged ahead of a real draft — see
    league_roster_slots_settings' own migration docstring. None if
    nothing's been staged (including once a real draft exists)."""
    row = await conn.fetchval(
        "SELECT roster_slots FROM league_roster_slots_settings WHERE season = $1 AND league_id = $2",
        season, league_id,
    )
    if isinstance(row, str):
        return json.loads(row)
    return row


async def upsert_roster_slots_setting(conn, season: int, roster_slots: dict, league_id: int = DEFAULT_LEAGUE_ID):
    await conn.execute(
        """
        INSERT INTO league_roster_slots_settings (season, league_id, roster_slots)
        VALUES ($1, $2, $3)
        ON CONFLICT (season, league_id) DO UPDATE SET roster_slots = EXCLUDED.roster_slots, updated_at = now()
        """,
        season, league_id, json.dumps(roster_slots),
    )


async def get_effective_roster_slots(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    """The season's roster shape, whichever of the two possible homes
    it's currently in — draft_config.roster_slots once a real draft
    exists, or the staged league_roster_slots_settings value ahead of
    that. None if neither has one set (a season nobody's touched yet)."""
    from_config = await conn.fetchval(
        "SELECT roster_slots FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
    )
    if from_config is not None:
        return json.loads(from_config) if isinstance(from_config, str) else from_config
    return await get_roster_slots_setting(conn, season, league_id)


async def get_position_max_setting(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    """A pre-set per-position roster cap staged ahead of a real draft —
    same shape as get_roster_slots_setting above, just the position_max
    sibling column. None if nothing's been staged (including once a
    real draft exists, or if this league has never configured caps at
    all — see draft_autopick.py's own fallback for what that means)."""
    row = await conn.fetchval(
        "SELECT position_max FROM league_roster_slots_settings WHERE season = $1 AND league_id = $2",
        season, league_id,
    )
    if isinstance(row, str):
        return json.loads(row)
    return row


async def upsert_position_max_setting(conn, season: int, position_max: dict, league_id: int = DEFAULT_LEAGUE_ID):
    # roster_slots is NOT NULL on this table — a commissioner setting
    # position_max before ever staging a roster shape still needs a
    # real value on first insert, so DEFAULT_ROSTER_SLOTS fills that
    # gap. ON CONFLICT only ever touches position_max/updated_at, so
    # this can never clobber a roster_slots value staged separately
    # (before or after this call) via upsert_roster_slots_setting.
    await conn.execute(
        """
        INSERT INTO league_roster_slots_settings (season, league_id, roster_slots, position_max)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (season, league_id) DO UPDATE SET position_max = EXCLUDED.position_max, updated_at = now()
        """,
        season, league_id, json.dumps(DEFAULT_ROSTER_SLOTS), json.dumps(position_max),
    )


async def get_effective_position_max(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    """The season's per-position roster caps, whichever of the two
    possible homes it's currently in — draft_config.position_max once a
    real draft exists, or the staged league_roster_slots_settings value
    ahead of that. None if neither has one set — unlike roster_slots,
    this is a genuinely normal, common state (a league that's never
    configured caps at all), not just "a season nobody's touched yet."""
    from_config = await conn.fetchval(
        "SELECT position_max FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
    )
    if from_config is not None:
        return json.loads(from_config) if isinstance(from_config, str) else from_config
    return await get_position_max_setting(conn, season, league_id)
