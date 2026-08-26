"""Read-only queries for the draft (app/routers/draft.py) — mirrors
app/queries/keepers.py's split (plain reads live here, the actual
pick/turn mutations live in app/domain/draft_engine.py)."""
import json


async def get_draft_pool(conn, season: int, position: str | None = None, search: str | None = None):
    query = """
        SELECT p.sleeper_player_id, p.full_name, p.position, p.pro_team, p.search_rank, p.injury_status,
               dp.pick_number IS NOT NULL AS drafted
        FROM players p
        LEFT JOIN draft_picks dp ON dp.sleeper_player_id = p.sleeper_player_id AND dp.season = $1
        WHERE p.is_draftable
    """
    params = [season]
    if position:
        query += f" AND p.position = ${len(params) + 1}"
        params.append(position)
    if search:
        query += f" AND p.full_name ILIKE ${len(params) + 1}"
        params.append(f"%{search}%")
    query += " ORDER BY drafted ASC, p.search_rank ASC NULLS LAST, p.full_name ASC"
    return await conn.fetch(query, *params)


async def get_draft_state(conn, season: int):
    config = await conn.fetchrow("SELECT * FROM draft_config WHERE season = $1", season)
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
        WHERE dp.season = $1
        ORDER BY dp.pick_number
        """,
        season,
    )
    return {"config": config_dict, "picks": [dict(p) for p in picks]}


async def get_team_roster_positions(conn, season: int, team_id: int) -> list[str]:
    rows = await conn.fetch(
        "SELECT p.position FROM current_rosters cr JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id "
        "WHERE cr.season = $1 AND cr.team_id = $2",
        season, team_id,
    )
    return [r["position"] for r in rows]
