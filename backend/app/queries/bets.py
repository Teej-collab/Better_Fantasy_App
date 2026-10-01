"""
Bet tracking's reads and writes (migration d7a2c4e8f1b9). Every read of
a bet is scoped by the caller: a user's own bets by user_id, or one
shared bet for a member of its league — app/routers/bets.py never takes
a user_id from the client.
"""
import datetime

_BET_COLUMNS = (
    "id, user_id, owner_id, league_id, sportsbook, stake_cents, odds_american, payout_cents, status, "
    "status_set_manually, source, note, shared_at, placed_at, settled_at, created_at"
)
_LEG_COLUMNS = (
    "id, bet_id, position, description, market, player_name, espn_player_id, sleeper_player_id, team_abbr, "
    "stat_key, line, direction, odds_american, espn_event_id, status, final_value, settled_at"
)


async def insert_bet(conn, user_id: int, owner_id: int | None, league_id: int | None, bet: dict, legs: list[dict]) -> int:
    async with conn.transaction():
        bet_id = await conn.fetchval(
            """
            INSERT INTO bets (user_id, owner_id, league_id, sportsbook, stake_cents, odds_american, payout_cents, source, note, placed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id
            """,
            user_id, owner_id, league_id, bet.get("sportsbook"), bet.get("stake_cents"), bet.get("odds_american"),
            bet.get("payout_cents"), bet.get("source", "manual"), bet.get("note"), bet.get("placed_at"),
        )
        await conn.executemany(
            """
            INSERT INTO bet_legs (bet_id, position, description, market, player_name, espn_player_id, sleeper_player_id,
                                  team_abbr, stat_key, line, direction, odds_american, espn_event_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            """,
            [
                (
                    bet_id, i, leg["description"], leg["market"], leg.get("player_name"), leg.get("espn_player_id"),
                    leg.get("sleeper_player_id"), leg.get("team_abbr"), leg.get("stat_key"), leg.get("line"),
                    leg.get("direction"), leg.get("odds_american"), leg.get("espn_event_id"),
                )
                for i, leg in enumerate(legs)
            ],
        )
    return bet_id


async def list_user_bets(conn, user_id: int, limit: int = 100) -> list:
    return await conn.fetch(
        f"SELECT {_BET_COLUMNS} FROM bets WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2", user_id, limit
    )


async def get_user_bet(conn, user_id: int, bet_id: int):
    return await conn.fetchrow(f"SELECT {_BET_COLUMNS} FROM bets WHERE id = $1 AND user_id = $2", bet_id, user_id)


async def get_shared_bet(conn, bet_id: int):
    """A bet its owner has shared — the caller still has to check the
    reader is in the bet's league."""
    return await conn.fetchrow(f"SELECT {_BET_COLUMNS} FROM bets WHERE id = $1 AND shared_at IS NOT NULL", bet_id)


async def legs_for_bets(conn, bet_ids: list[int]) -> dict[int, list]:
    if not bet_ids:
        return {}
    rows = await conn.fetch(
        f"SELECT {_LEG_COLUMNS} FROM bet_legs WHERE bet_id = ANY($1::int[]) ORDER BY bet_id, position", bet_ids
    )
    out: dict[int, list] = {}
    for r in rows:
        out.setdefault(r["bet_id"], []).append(r)
    return out


async def user_bet_ids_in_game(conn, user_id: int, espn_event_id: str) -> list[int]:
    rows = await conn.fetch(
        """
        SELECT DISTINCT b.id FROM bets b JOIN bet_legs l ON l.bet_id = b.id
        WHERE b.user_id = $1 AND l.espn_event_id = $2
        """,
        user_id, espn_event_id,
    )
    return [r["id"] for r in rows]


async def settle_leg(conn, leg_id: int, status: str, final_value: float | None) -> None:
    await conn.execute(
        "UPDATE bet_legs SET status = $2, final_value = $3, settled_at = now() WHERE id = $1 AND status = 'open'",
        leg_id, status, final_value,
    )


async def set_leg_status(conn, bet_id: int, leg_id: int, status: str) -> bool:
    result = await conn.execute(
        "UPDATE bet_legs SET status = $3, settled_at = CASE WHEN $3 = 'open' THEN NULL ELSE now() END WHERE id = $2 AND bet_id = $1",
        bet_id, leg_id, status,
    )
    return result != "UPDATE 0"


async def settle_bet(conn, bet_id: int, status: str) -> None:
    """Automatic result — never overrides one the user set by hand."""
    await conn.execute(
        """
        UPDATE bets SET status = $2, settled_at = CASE WHEN $2 = 'open' THEN NULL ELSE COALESCE(settled_at, now()) END
        WHERE id = $1 AND NOT status_set_manually AND status IS DISTINCT FROM $2
        """,
        bet_id, status,
    )


async def set_bet_status_manually(conn, user_id: int, bet_id: int, status: str | None) -> bool:
    """`status` None hands the result back to automatic grading."""
    if status is None:
        result = await conn.execute(
            "UPDATE bets SET status_set_manually = FALSE, status = 'open', settled_at = NULL WHERE id = $1 AND user_id = $2",
            bet_id, user_id,
        )
    else:
        result = await conn.execute(
            "UPDATE bets SET status_set_manually = TRUE, status = $3, settled_at = now() WHERE id = $1 AND user_id = $2",
            bet_id, user_id, status,
        )
    return result != "UPDATE 0"


async def update_bet_note(conn, user_id: int, bet_id: int, note: str | None) -> None:
    await conn.execute("UPDATE bets SET note = $3 WHERE id = $1 AND user_id = $2", bet_id, user_id, note)


async def delete_bet(conn, user_id: int, bet_id: int) -> bool:
    result = await conn.execute("DELETE FROM bets WHERE id = $1 AND user_id = $2", bet_id, user_id)
    return result != "DELETE 0"


async def set_shared(conn, user_id: int, bet_id: int, shared: bool) -> datetime.datetime | None:
    return await conn.fetchval(
        "UPDATE bets SET shared_at = CASE WHEN $3 THEN COALESCE(shared_at, now()) ELSE NULL END "
        "WHERE id = $1 AND user_id = $2 RETURNING shared_at",
        bet_id, user_id, shared,
    )


async def players_by_last_name(conn, last_name: str) -> list:
    """Candidates for matching a slip's player name (app/domain/bets.name_key
    does the exact comparison in Python)."""
    return await conn.fetch(
        """
        SELECT sleeper_player_id, espn_player_id, full_name, position, pro_team
        FROM players
        WHERE last_name ILIKE $1 OR full_name ILIKE $2
        ORDER BY (pro_team IS NULL), search_rank NULLS LAST
        LIMIT 40
        """,
        last_name, f"%{last_name}%",
    )


async def bet_owner_names(conn, user_ids: list[int]) -> dict[int, str]:
    rows = await conn.fetch(
        """
        SELECT u.id AS user_id, COALESCE(o.display_name, u.display_name, 'Someone') AS name
        FROM users u
        LEFT JOIN owner_users ou ON ou.user_id = u.id
        LEFT JOIN owners o ON o.owner_id = ou.owner_id
        WHERE u.id = ANY($1::int[])
        """,
        user_ids,
    )
    return {r["user_id"]: r["name"] for r in rows}
