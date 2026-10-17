"""
League Bets' reads and writes (migration e2b8d4f6a1c3): a league's
shared bets, the people who placed them, and tails, reactions and
follows. Only shared bets are ever read here; app/routers/league_bets.py
checks the reader is in the league first.
"""
import datetime

from app.queries.bets import _BET_COLUMNS


async def shared_bets(conn, league_id: int, since: datetime.datetime, limit: int = 500) -> list:
    """The league's shared bets since `since`, oldest first."""
    rows = await conn.fetch(
        f"""
        SELECT {_BET_COLUMNS} FROM bets
        WHERE league_id = $1 AND shared_at IS NOT NULL AND created_at >= $2
        ORDER BY created_at DESC LIMIT $3
        """,
        league_id, since, limit,
    )
    return list(reversed(rows))


async def members(conn, league_id: int, season: int) -> dict[int, dict]:
    """user id → name, team name, logo and chat color for everyone in
    the league."""
    rows = await conn.fetch(
        """
        SELECT DISTINCT ON (lm.user_id)
               lm.user_id, COALESCE(o.display_name, u.display_name, 'Someone') AS name,
               o.owner_id, o.logo_url, o.chat_color, t.team_name
        FROM league_members lm
        JOIN users u ON u.id = lm.user_id
        LEFT JOIN owner_users ou ON ou.user_id = lm.user_id
        LEFT JOIN owners o ON o.owner_id = ou.owner_id
        LEFT JOIN teams_by_season t ON t.owner_id = o.owner_id AND t.league_id = lm.league_id AND t.season = $2
        WHERE lm.league_id = $1
        ORDER BY lm.user_id, t.team_name NULLS LAST
        """,
        league_id, season,
    )
    return {
        r["user_id"]: {
            "user_id": r["user_id"],
            "name": r["name"],
            "team_name": r["team_name"],
            "logo_url": r["logo_url"],
            "color": r["chat_color"],
            "owner_id": r["owner_id"],
        }
        for r in rows
    }


async def tails_for(conn, bet_ids: list[int]) -> list:
    if not bet_ids:
        return []
    return await conn.fetch("SELECT bet_id, user_id, tail_bet_id FROM bet_tails WHERE bet_id = ANY($1::int[])", bet_ids)


async def reactions_for(conn, bet_ids: list[int]) -> list:
    if not bet_ids:
        return []
    return await conn.fetch("SELECT bet_id, user_id, kind FROM bet_reactions WHERE bet_id = ANY($1::int[])", bet_ids)


async def existing_tail(conn, bet_id: int, user_id: int):
    return await conn.fetchrow("SELECT tail_bet_id FROM bet_tails WHERE bet_id = $1 AND user_id = $2", bet_id, user_id)


async def add_tail(conn, bet_id: int, user_id: int, tail_bet_id: int) -> None:
    await conn.execute(
        "INSERT INTO bet_tails (bet_id, user_id, tail_bet_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        bet_id, user_id, tail_bet_id,
    )


async def set_reaction(conn, bet_id: int, user_id: int, kind: str, on: bool) -> None:
    if on:
        await conn.execute(
            "INSERT INTO bet_reactions (bet_id, user_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            bet_id, user_id, kind,
        )
    else:
        await conn.execute("DELETE FROM bet_reactions WHERE bet_id = $1 AND user_id = $2 AND kind = $3", bet_id, user_id, kind)


async def is_following(conn, follower_user_id: int, target_user_id: int) -> bool:
    return bool(
        await conn.fetchval(
            "SELECT 1 FROM bet_follows WHERE follower_user_id = $1 AND target_user_id = $2", follower_user_id, target_user_id
        )
    )


async def set_follow(conn, follower_user_id: int, target_user_id: int, on: bool) -> None:
    if on:
        await conn.execute(
            "INSERT INTO bet_follows (follower_user_id, target_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            follower_user_id, target_user_id,
        )
    else:
        await conn.execute(
            "DELETE FROM bet_follows WHERE follower_user_id = $1 AND target_user_id = $2", follower_user_id, target_user_id
        )


async def follower_owner_ids(conn, target_user_id: int, league_id: int) -> list[int]:
    """The teams to ping when this person shares a bet: followers who are
    still in the league with them."""
    rows = await conn.fetch(
        """
        SELECT DISTINCT ou.owner_id
        FROM bet_follows f
        JOIN league_members lm ON lm.user_id = f.follower_user_id AND lm.league_id = $2
        JOIN owner_users ou ON ou.user_id = f.follower_user_id
        WHERE f.target_user_id = $1
        """,
        target_user_id, league_id,
    )
    return [r["owner_id"] for r in rows]
