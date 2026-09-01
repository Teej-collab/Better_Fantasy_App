"""Multi-league membership — Phase 1/2 of the "Open Roster" migration
(see TODO.md's PHASE 9 entry). league_id isn't threaded through any
fantasy data yet (rosters, drafts, matchups, scoring stay exactly as
they are); this module only tracks who belongs to which league,
starting with the one real league every existing member already plays
in."""

from app.config import DEFAULT_LEAGUE_ID


async def create_league(conn, name: str, created_by_user_id: int, invite_code: str) -> int:
    return await conn.fetchval(
        "INSERT INTO leagues (name, created_by_user_id, invite_code) VALUES ($1, $2, $3) RETURNING id",
        name, created_by_user_id, invite_code,
    )


async def add_member(conn, league_id: int, user_id: int, role: str) -> None:
    """Idempotent — re-running the backfill, or a member logging in
    again, never creates a duplicate row or a duplicate-key error.

    Also auto-activates this league for the user if they don't already
    have an active one (see TODO.md's PHASE 9 entry, "session-resolved
    active league") — the common case (join or create your one league)
    needs zero extra clicks to start seeing its data. Never overwrites
    an existing active_league_id — joining a second league doesn't
    silently switch you away from the one you're already using."""
    await conn.execute(
        """
        INSERT INTO league_members (league_id, user_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (league_id, user_id) DO NOTHING
        """,
        league_id, user_id, role,
    )
    await conn.execute(
        "UPDATE users SET active_league_id = $1 WHERE id = $2 AND active_league_id IS NULL",
        league_id, user_id,
    )


async def get_active_league_id(conn, user_id: int) -> int | None:
    return await conn.fetchval("SELECT active_league_id FROM users WHERE id = $1", user_id)


async def set_active_league_id(conn, user_id: int, league_id: int) -> None:
    await conn.execute("UPDATE users SET active_league_id = $1 WHERE id = $2", league_id, user_id)


async def get_default_league_id(conn) -> int | None:
    """The one real league, once Phase 2's backfill has created it.
    Returns None gracefully before that (or in an environment with no
    league yet) — a bridge for the single-league era, not a real
    "current league" concept. Real league selection (a user choosing
    or switching between leagues) is a later phase, once an account
    can actually belong to more than one."""
    return await conn.fetchval("SELECT id FROM leagues ORDER BY id LIMIT 1")


async def get_league_by_invite_code(conn, invite_code: str):
    return await conn.fetchrow("SELECT * FROM leagues WHERE invite_code = $1", invite_code)


async def get_league(conn, league_id: int):
    return await conn.fetchrow("SELECT * FROM leagues WHERE id = $1", league_id)


async def get_membership(conn, league_id: int, user_id: int):
    return await conn.fetchrow(
        "SELECT * FROM league_members WHERE league_id = $1 AND user_id = $2", league_id, user_id
    )


async def seed_default_scoring_rules(conn, league_id: int, season: int, source_league_id: int = DEFAULT_LEAGUE_ID) -> int:
    """Copies League #1's real scoring rules into a newly created
    league, so it has a real, working configuration from the moment
    it's created rather than empty rows and a failed weekly compute
    the first time someone tries to score a week. Only possible at all
    since migration 130f4acc3a50 widened league_scoring_rules' unique
    constraint to include league_id — before that, two leagues could
    never both have a row for the same (season, stat_category). A
    commissioner can customize their own copy afterward, once a
    scoring-rules editing UI exists (see TODO.md's PHASE 9 entry)."""
    rows = await conn.fetch(
        "SELECT stat_category, points_per_unit FROM league_scoring_rules WHERE league_id = $1 AND season = $2",
        source_league_id, season,
    )
    if not rows:
        return 0
    await conn.executemany(
        "INSERT INTO league_scoring_rules (season, stat_category, points_per_unit, league_id) "
        "VALUES ($1, $2, $3, $4) ON CONFLICT (season, stat_category, league_id) DO NOTHING",
        [(season, r["stat_category"], r["points_per_unit"], league_id) for r in rows],
    )
    return len(rows)


async def list_unclaimed_owners(conn, league_id: int):
    """Owners in this league nobody's account is linked to yet — see
    TODO.md's PHASE 9 entry, "any League #1 owner can self-claim their
    history." Scoped by league via teams_by_season (owners itself has
    no league_id — it's a global real-person registry, see Phase 5) —
    an owner only counts as belonging to this league if they actually
    have a team in it."""
    return await conn.fetch(
        """
        SELECT DISTINCT o.owner_id, o.display_name
        FROM owners o
        JOIN teams_by_season t ON t.owner_id = o.owner_id
        WHERE t.league_id = $1 AND o.user_id IS NULL
        ORDER BY o.display_name
        """,
        league_id,
    )


async def claim_owner(conn, league_id: int, owner_id: int, user_id: int) -> bool:
    """Links a real historical owner to the caller's account — every
    table already keyed by that owner_id (chug debts, keeper picks,
    past seasons, matchups, awards) is immediately theirs, no data
    migration needed. Scoped to owners who actually have a team in
    this league, and only succeeds if nobody's claimed it already
    (first-claim-wins, the same trust level Discord auto-linking
    already has today — see app/queries/auth.py). Returns False
    (never raises) if the owner doesn't belong to this league or is
    already claimed, so the router can turn that into a clean 404/409
    rather than a generic error."""
    result = await conn.execute(
        """
        UPDATE owners SET user_id = $1
        WHERE owner_id = $2 AND user_id IS NULL
          AND EXISTS (SELECT 1 FROM teams_by_season t WHERE t.owner_id = owners.owner_id AND t.league_id = $3)
        """,
        user_id, owner_id, league_id,
    )
    return result != "UPDATE 0"


async def list_leagues_for_user(conn, user_id: int):
    return await conn.fetch(
        """
        SELECT l.id, l.name, l.invite_code, l.created_at, lm.role
        FROM league_members lm
        JOIN leagues l ON l.id = lm.league_id
        WHERE lm.user_id = $1
        ORDER BY lm.joined_at
        """,
        user_id,
    )
