"""Keeper-league tracking (migration d01d88f0ac00). Two tables:
league_keeper_rules (one row per season — max_keepers, an optional cap
on consecutive years the same player can be kept, an optional deadline,
and whether the commissioner has locked the window) and
keeper_selections (one row per owner per player kept for a season).

Same "no owner_id from the caller" discipline as
app/queries/owner_preferences.py — enforced in app/routers/keepers.py,
not here, but every function here still takes owner_id as an explicit
argument. Per-owner max_keepers/deadline/lock enforcement also lives in
the router, matching this app's established "validate in the router,
not the database" convention for preference-shaped data.

espn_player_id (not player_name text) is the identity used to carry a
keeper forward year over year — see get_prior_season_selections. The
roster POOL an owner picks a keeper from is no longer sourced here —
app/routers/keepers.py's _get_live_roster_pool reads ESPN's live
roster directly instead of this app's own `rosters` table (which only
syncs by real NFL week, so it'd be many months stale by keeper-
selection time — see that function's docstring for the full reasoning).
"""

from app.config import DEFAULT_LEAGUE_ID


async def get_rules(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetchrow(
        "SELECT * FROM league_keeper_rules WHERE season = $1 AND league_id = $2", season, league_id
    )


async def upsert_rules(
    conn,
    season: int,
    max_keepers: int,
    max_consecutive_years: int | None,
    keeper_deadline,
    league_id: int = DEFAULT_LEAGUE_ID,
):
    """Commissioner-only (enforced in the router). Refuses to change
    anything once the season's window is locked — a commissioner who
    wants to change the rules after locking has to unlock first via
    unlock_rules, a deliberate two-step so a rule change never
    silently invalidates selections owners already made under it."""
    return await conn.fetchrow(
        """
        INSERT INTO league_keeper_rules (season, max_keepers, max_consecutive_years, keeper_deadline, league_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (season, league_id) DO UPDATE SET
            max_keepers = EXCLUDED.max_keepers,
            max_consecutive_years = EXCLUDED.max_consecutive_years,
            keeper_deadline = EXCLUDED.keeper_deadline
        WHERE league_keeper_rules.locked_at IS NULL
        RETURNING *
        """,
        season, max_keepers, max_consecutive_years, keeper_deadline, league_id,
    )


async def lock_rules(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    """No-op (returns None) if there's no rules row yet for this season,
    or if it's already locked — the router treats both as "nothing to
    do" rather than an error, re-fetching the current row either way."""
    return await conn.fetchrow(
        "UPDATE league_keeper_rules SET locked_at = now() "
        "WHERE season = $1 AND league_id = $2 AND locked_at IS NULL RETURNING *",
        season, league_id,
    )


async def unlock_rules(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetchrow(
        "UPDATE league_keeper_rules SET locked_at = NULL WHERE season = $1 AND league_id = $2 RETURNING *",
        season, league_id,
    )


async def get_selections(conn, season: int, owner_id: int, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetch(
        "SELECT * FROM keeper_selections WHERE season = $1 AND owner_id = $2 AND league_id = $3 "
        "ORDER BY player_name",
        season, owner_id, league_id,
    )


async def replace_selections(conn, season: int, owner_id: int, players: list[dict], league_id: int = DEFAULT_LEAGUE_ID):
    """Full replace, not a diff/patch — a keeper picker always submits
    its whole intended list, same as how HomeCardDeck.tsx's card order
    is saved wholesale rather than as individual add/remove ops. Runs
    in a transaction so a mid-write failure can't leave an owner with
    a half-updated keeper list."""
    async with conn.transaction():
        await conn.execute(
            "DELETE FROM keeper_selections WHERE season = $1 AND owner_id = $2 AND league_id = $3",
            season, owner_id, league_id,
        )
        for p in players:
            await conn.execute(
                """
                INSERT INTO keeper_selections
                    (season, owner_id, espn_player_id, player_name, consecutive_years_kept, league_id)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                season, owner_id, p["espn_player_id"], p["player_name"], p.get("consecutive_years_kept", 1),
                league_id,
            )
    return await get_selections(conn, season, owner_id, league_id)


async def get_all_selections(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    """Every owner's locked-or-not keeper picks for a season — used by
    app/domain/draft_engine.py's seed_keepers_from_locked_selections to
    process every owner's keeper into the real draft in one batch,
    unlike get_selections above (single-owner, for the picker UI)."""
    return await conn.fetch(
        "SELECT * FROM keeper_selections WHERE season = $1 AND league_id = $2 ORDER BY owner_id, player_name",
        season, league_id,
    )


async def get_prior_season_selections(conn, owner_id: int, prior_season: int, league_id: int = DEFAULT_LEAGUE_ID):
    """What this owner kept last season — the carryover candidates for
    this season's picker (Part E), each checked by the router against
    this season's roster pool (still on the team?) and
    max_consecutive_years (still eligible?) before being offered."""
    return await conn.fetch(
        "SELECT * FROM keeper_selections WHERE season = $1 AND owner_id = $2 AND league_id = $3",
        prior_season, owner_id, league_id,
    )
