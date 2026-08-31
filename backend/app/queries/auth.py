"""Queries backing Discord login — separate from app/queries/league.py
since this is a different concern (identity, not league data)."""

from app.queries import leagues as leagues_queries


async def get_owner_by_discord_id(conn, discord_user_id: int):
    return await conn.fetchrow(
        "SELECT owner_id, display_name FROM owners WHERE discord_user_id = $1",
        discord_user_id,
    )


async def get_or_create_user_for_owner(
    conn, owner_id: int, discord_user_id: int, discord_username: str
) -> int:
    """Links (or re-links) the given owner to a users row identified by
    discord_user_id. Idempotent — safe to call on every login.

    Also enrolls the user into the one real league, if it's been
    backfilled yet (Phase 2 of the multi-league migration — see
    TODO.md's PHASE 9 entry). Most existing league members have never
    actually logged into the web app before (only their Discord id was
    pre-registered), so this is how they end up with a real
    league_members row automatically the first time they do, rather
    than the backfill needing to fabricate accounts for people who've
    never signed in."""
    user_id = await conn.fetchval(
        """
        INSERT INTO users (discord_user_id, discord_username)
        VALUES ($1, $2)
        ON CONFLICT (discord_user_id) DO UPDATE SET discord_username = EXCLUDED.discord_username
        RETURNING id
        """,
        discord_user_id, discord_username,
    )
    await conn.execute(
        "UPDATE owners SET user_id = $1 WHERE owner_id = $2",
        user_id, owner_id,
    )
    league_id = await leagues_queries.get_default_league_id(conn)
    if league_id is not None:
        await leagues_queries.add_member(conn, league_id, user_id, "member")
    return user_id
