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


async def get_user_by_email(conn, email: str):
    return await conn.fetchrow("SELECT * FROM users WHERE email = $1", email)


async def get_or_create_user_for_google(conn, google_user_id: str, email: str | None, display_name: str) -> int:
    """Google sign-in — unlike get_or_create_user_for_owner (Discord),
    there's no pre-existing owners.* membership data to verify against,
    so this follows create_user_with_password's self-serve shape: no
    owners row, no league_members enrollment here — that only happens
    once the account actually joins or creates a league.

    Three cases, in order:
      1. google_user_id already links to a user (returning sign-in) —
         return it directly.
      2. No google_user_id match, but the email matches an existing
         account (most likely a password signup using the same real
         email) — link google_user_id onto that row rather than
         creating a confusing second, empty account. This is a
         deliberate difference from Discord's own no-linking
         precedent: Discord's OAuth doesn't reliably return a verified
         email at all, so linking-by-email was never possible there;
         Google always does, so the same silent-duplicate problem
         doesn't need to exist here.
      3. Neither matches — a genuinely new account.
    """
    existing = await conn.fetchrow("SELECT id FROM users WHERE google_user_id = $1", google_user_id)
    if existing is not None:
        return existing["id"]

    if email is not None:
        by_email = await conn.fetchrow("SELECT id FROM users WHERE email = $1", email)
        if by_email is not None:
            await conn.execute("UPDATE users SET google_user_id = $1 WHERE id = $2", google_user_id, by_email["id"])
            return by_email["id"]

    return await conn.fetchval(
        """
        INSERT INTO users (google_user_id, email, display_name)
        VALUES ($1, $2, $3)
        RETURNING id
        """,
        google_user_id, email, display_name,
    )


async def create_user_with_password(conn, email: str, password_hash: str, display_name: str) -> int:
    """Phase 5 of the multi-league migration (see TODO.md's PHASE 9
    entry) — a self-serve account with no owners row at all: nothing
    to link yet, since this user hasn't created or joined a league.
    Unlike get_or_create_user_for_owner, this never touches
    league_members — that only happens once the account actually
    creates or joins one (a later phase)."""
    return await conn.fetchval(
        """
        INSERT INTO users (email, password_hash, display_name)
        VALUES ($1, $2, $3)
        RETURNING id
        """,
        email, password_hash, display_name,
    )
