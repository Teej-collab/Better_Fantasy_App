"""Multi-league membership — Phase 1/2 of the "Open Roster" migration
(see TODO.md's PHASE 9 entry). league_id isn't threaded through any
fantasy data yet (rosters, drafts, matchups, scoring stay exactly as
they are); this module only tracks who belongs to which league,
starting with the one real league every existing member already plays
in."""


async def create_league(conn, name: str, created_by_user_id: int, invite_code: str) -> int:
    return await conn.fetchval(
        "INSERT INTO leagues (name, created_by_user_id, invite_code) VALUES ($1, $2, $3) RETURNING id",
        name, created_by_user_id, invite_code,
    )


async def add_member(conn, league_id: int, user_id: int, role: str) -> None:
    """Idempotent — re-running the backfill, or a member logging in
    again, never creates a duplicate row or a duplicate-key error."""
    await conn.execute(
        """
        INSERT INTO league_members (league_id, user_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (league_id, user_id) DO NOTHING
        """,
        league_id, user_id, role,
    )


async def get_default_league_id(conn) -> int | None:
    """The one real league, once Phase 2's backfill has created it.
    Returns None gracefully before that (or in an environment with no
    league yet) — a bridge for the single-league era, not a real
    "current league" concept. Real league selection (a user choosing
    or switching between leagues) is a later phase, once an account
    can actually belong to more than one."""
    return await conn.fetchval("SELECT id FROM leagues ORDER BY id LIMIT 1")
