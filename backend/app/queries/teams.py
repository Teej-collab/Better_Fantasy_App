"""Self-serve team creation — the piece that actually makes a
brand-new league playable (Phase 5 follow-on, see TODO.md's PHASE 9
entry). `teams_by_season.owner_id` still references `owners`, the
same global real-person registry Discord accounts have always used
(display_name, chat_color, and dozens of other tables already key off
owner_id — rivalries, chug, keeper picks, etc.) — nothing about that
table's shape needed to change. An owner row was never inherently
League #1-specific, it just happened to only ever contain League #1's
people until now; the same owner_id can hold a team in more than one
league."""


async def get_or_create_owner_for_user(conn, user_id: int, display_name: str) -> int:
    existing = await conn.fetchval("SELECT owner_id FROM owners WHERE user_id = $1", user_id)
    if existing is not None:
        return existing
    return await conn.fetchval(
        "INSERT INTO owners (user_id, display_name) VALUES ($1, $2) RETURNING owner_id",
        user_id, display_name,
    )


async def create_team(conn, league_id: int, season: int, owner_id: int, team_name: str) -> dict:
    synthetic_espn_team_id = await conn.fetchval("SELECT nextval('synthetic_espn_team_id_seq')")
    row = await conn.fetchrow(
        """
        INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id AS team_id, season, owner_id, team_name, league_id
        """,
        season, synthetic_espn_team_id, owner_id, team_name, league_id,
    )
    return dict(row)


async def get_team_for_owner_in_league(conn, league_id: int, season: int, owner_id: int):
    return await conn.fetchrow(
        "SELECT id AS team_id, team_name FROM teams_by_season WHERE league_id = $1 AND season = $2 AND owner_id = $3",
        league_id, season, owner_id,
    )


async def reassign_team(conn, league_id: int, season: int, team_id: int, new_user_id: int, display_name: str) -> dict | None:
    """Hands an existing team's roster and history to a different real
    person — the companion action to removing a member (see
    queries/leagues.py's remove_member), for when a departed owner's
    team should go to a replacement rather than sit vacant. Reuses
    get_or_create_owner_for_user exactly like the self-serve "create a
    team" flow does, so the new owner gets a real owners row (or their
    existing one, if they already have one from another team/league)
    rather than a one-off. Only current_rosters' team_id stays the
    same — the roster itself, and everything else keyed off it, is
    completely untouched by this. Returns None (never raises) if no
    such team exists in this league/season, letting the router turn
    that into a clean 404."""
    owner_id = await get_or_create_owner_for_user(conn, new_user_id, display_name)
    row = await conn.fetchrow(
        """
        UPDATE teams_by_season SET owner_id = $1
        WHERE id = $2 AND league_id = $3 AND season = $4
        RETURNING id AS team_id, team_name, owner_id
        """,
        owner_id, team_id, league_id, season,
    )
    return dict(row) if row else None


async def list_teams_for_league(conn, league_id: int, season: int):
    return await conn.fetch(
        """
        SELECT t.id AS team_id, t.team_name, o.owner_id, o.display_name AS owner_name
        FROM teams_by_season t
        JOIN owners o ON o.owner_id = t.owner_id
        WHERE t.league_id = $1 AND t.season = $2
        ORDER BY t.team_name
        """,
        league_id, season,
    )
