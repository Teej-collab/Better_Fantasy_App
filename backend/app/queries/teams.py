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
