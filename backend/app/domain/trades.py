"""Trades — a second mutator of current_rosters alongside
app/domain/lineup_engine.py's free-agent add/drop, using the exact same
conventions (a DB transaction around any write, roster-capacity checks
via app/domain/roster_slots.py, players default onto the bench). A
trade is strictly a two-team, player-for-player swap: no free agents,
no draft picks/future considerations — those aren't tradeable assets
anywhere in this app's data model today.

Ownership and roster-capacity are validated twice: once at proposal
time (fail fast, don't let an obviously-bad trade sit in someone's
inbox), and again immediately before a trade actually mutates rosters
(on accept, or on commissioner approval of an awaiting_review trade) —
a player can be dropped or traded away by either side in between, so
the second check is the one that actually protects current_rosters'
one-team-per-player constraint, not the first.

Commissioner authorization lives in the router (require_league_
commissioner), same as every other commissioner-gated feature in this
app — review_trade below assumes the caller is already verified.
"""
import datetime
import json

from app.domain.roster_slots import BENCH_SLOT_LABEL, total_draftable_slots
from app.domain.trade_exceptions import (
    AssetNotOwnedError,
    EmptyTradeError,
    NotYourTradeError,
    RosterWouldExceedCapacityError,
    SameTeamTradeError,
    TradeDeadlinePassedError,
    TradeNotAwaitingReviewError,
    TradeNotFoundError,
    TradeNotPendingError,
)


async def get_trade_settings(conn, league_id: int, season: int) -> dict:
    row = await conn.fetchrow(
        "SELECT trade_deadline, review_required FROM league_trade_settings WHERE season = $1 AND league_id = $2",
        season, league_id,
    )
    if row is None:
        return {"season": season, "trade_deadline": None, "review_required": False}
    return {"season": season, "trade_deadline": row["trade_deadline"], "review_required": row["review_required"]}


async def upsert_trade_settings(
    conn, league_id: int, season: int, trade_deadline: datetime.datetime | None, review_required: bool
) -> dict:
    await conn.execute(
        """
        INSERT INTO league_trade_settings (season, league_id, trade_deadline, review_required)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (season, league_id) DO UPDATE SET trade_deadline = $3, review_required = $4
        """,
        season, league_id, trade_deadline, review_required,
    )
    return await get_trade_settings(conn, league_id, season)


async def _get_team_owner_user_id(conn, team_id: int) -> int | None:
    return await conn.fetchval(
        "SELECT o.user_id FROM teams_by_season t JOIN owners o ON o.owner_id = t.owner_id WHERE t.id = $1",
        team_id,
    )


async def _assert_owns_all(conn, season: int, team_id: int, sleeper_player_ids: list[str]) -> None:
    if not sleeper_player_ids:
        return
    rows = await conn.fetch(
        "SELECT sleeper_player_id FROM current_rosters "
        "WHERE season = $1 AND team_id = $2 AND sleeper_player_id = ANY($3::text[])",
        season, team_id, sleeper_player_ids,
    )
    owned = {r["sleeper_player_id"] for r in rows}
    missing = set(sleeper_player_ids) - owned
    if missing:
        raise AssetNotOwnedError(f"Not currently on that roster: {', '.join(sorted(missing))}")


async def _get_roster_slots(conn, season: int, league_id: int) -> dict:
    raw = await conn.fetchval(
        "SELECT roster_slots FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
    )
    if raw is None:
        return {}
    return json.loads(raw) if isinstance(raw, str) else raw


async def _assert_capacity_ok(
    conn, season: int, league_id: int, team_id: int, incoming_count: int, outgoing_count: int
) -> None:
    roster_slots = await _get_roster_slots(conn, season, league_id)
    capacity = total_draftable_slots(roster_slots)
    current_count = await conn.fetchval(
        "SELECT count(*) FROM current_rosters WHERE season = $1 AND team_id = $2", season, team_id
    )
    new_count = current_count + incoming_count - outgoing_count
    if new_count > capacity:
        raise RosterWouldExceedCapacityError(
            f"That trade would leave a roster with {new_count} players (capacity {capacity})"
        )


async def _validate_assets(
    conn, season: int, league_id: int, proposing_team_id: int, receiving_team_id: int, give: list[str], receive: list[str]
) -> None:
    await _assert_owns_all(conn, season, proposing_team_id, give)
    await _assert_owns_all(conn, season, receiving_team_id, receive)
    await _assert_capacity_ok(conn, season, league_id, proposing_team_id, len(receive), len(give))
    await _assert_capacity_ok(conn, season, league_id, receiving_team_id, len(give), len(receive))


async def get_trade(conn, trade_id: int) -> dict | None:
    row = await conn.fetchrow(
        "SELECT id, league_id, season, proposing_team_id, receiving_team_id, status, proposed_at, resolved_at "
        "FROM trades WHERE id = $1",
        trade_id,
    )
    if row is None:
        return None
    trade = dict(row)
    assets = await conn.fetch(
        """
        SELECT ta.sleeper_player_id, ta.from_team_id, ta.to_team_id, p.full_name AS player_name, p.position
        FROM trade_assets ta
        JOIN players p ON p.sleeper_player_id = ta.sleeper_player_id
        WHERE ta.trade_id = $1
        ORDER BY ta.id
        """,
        trade_id,
    )
    trade["assets"] = [dict(a) for a in assets]
    return trade


async def get_team_roster_for_trade(conn, season: int, team_id: int) -> list[dict]:
    """A plain "what's on this roster right now" list — deliberately
    not the fuller week-scored RosterEntry shape /me/team or /teams/{id}
    return (points/next_opponent/bye_week etc.); the trade proposal
    picker only ever needs to know who's tradeable, not this week's
    projections."""
    rows = await conn.fetch(
        """
        SELECT cr.sleeper_player_id, p.full_name AS player_name, p.position
        FROM current_rosters cr
        JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
        WHERE cr.season = $1 AND cr.team_id = $2
        ORDER BY p.position, p.full_name
        """,
        season, team_id,
    )
    return [dict(r) for r in rows]


async def list_trades_for_team(conn, team_id: int) -> list[dict]:
    rows = await conn.fetch(
        "SELECT id FROM trades WHERE proposing_team_id = $1 OR receiving_team_id = $1 ORDER BY proposed_at DESC",
        team_id,
    )
    return [await get_trade(conn, r["id"]) for r in rows]


async def list_pending_review(conn, league_id: int, season: int) -> list[dict]:
    rows = await conn.fetch(
        "SELECT id FROM trades WHERE league_id = $1 AND season = $2 AND status = 'awaiting_review' "
        "ORDER BY proposed_at",
        league_id, season,
    )
    return [await get_trade(conn, r["id"]) for r in rows]


async def propose_trade(
    conn, league_id: int, season: int, proposing_team_id: int, receiving_team_id: int,
    give: list[str], receive: list[str],
) -> dict:
    if proposing_team_id == receiving_team_id:
        raise SameTeamTradeError("Can't propose a trade with your own team")
    if not give or not receive:
        raise EmptyTradeError("A trade needs at least one player on each side")

    settings = await get_trade_settings(conn, league_id, season)
    if settings["trade_deadline"] is not None:
        if datetime.datetime.now(datetime.timezone.utc) > settings["trade_deadline"]:
            raise TradeDeadlinePassedError("The trade deadline for this season has passed")

    async with conn.transaction():
        await _validate_assets(conn, season, league_id, proposing_team_id, receiving_team_id, give, receive)
        trade_id = await conn.fetchval(
            "INSERT INTO trades (league_id, season, proposing_team_id, receiving_team_id) "
            "VALUES ($1, $2, $3, $4) RETURNING id",
            league_id, season, proposing_team_id, receiving_team_id,
        )
        for pid in give:
            await conn.execute(
                "INSERT INTO trade_assets (trade_id, sleeper_player_id, from_team_id, to_team_id) "
                "VALUES ($1, $2, $3, $4)",
                trade_id, pid, proposing_team_id, receiving_team_id,
            )
        for pid in receive:
            await conn.execute(
                "INSERT INTO trade_assets (trade_id, sleeper_player_id, from_team_id, to_team_id) "
                "VALUES ($1, $2, $3, $4)",
                trade_id, pid, receiving_team_id, proposing_team_id,
            )
    return await get_trade(conn, trade_id)


async def _apply_trade(conn, trade: dict) -> None:
    """Re-validates every asset is still where the trade expects it,
    then moves each one — DELETE + INSERT rather than UPDATE team_id,
    matching current_rosters' one-row-per-(team,player) shape and its
    acquired_via convention (every other acquisition path here inserts
    a fresh row too, see lineup_engine.add_free_agent)."""
    give = [a["sleeper_player_id"] for a in trade["assets"] if a["from_team_id"] == trade["proposing_team_id"]]
    receive = [a["sleeper_player_id"] for a in trade["assets"] if a["from_team_id"] == trade["receiving_team_id"]]
    await _validate_assets(
        conn, trade["season"], trade["league_id"], trade["proposing_team_id"], trade["receiving_team_id"], give, receive
    )
    for asset in trade["assets"]:
        await conn.execute(
            "DELETE FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            trade["season"], asset["from_team_id"], asset["sleeper_player_id"],
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id) "
            "VALUES ($1, $2, $3, $4, 'trade', $5)",
            trade["season"], asset["to_team_id"], asset["sleeper_player_id"], BENCH_SLOT_LABEL, trade["league_id"],
        )


async def respond_to_trade(conn, trade_id: int, responding_user_id: int, accept: bool) -> dict:
    trade = await get_trade(conn, trade_id)
    if trade is None:
        raise TradeNotFoundError(f"Trade {trade_id} not found")
    if trade["status"] != "pending":
        raise TradeNotPendingError(f"This trade is no longer pending (status: {trade['status']})")
    receiving_owner_user_id = await _get_team_owner_user_id(conn, trade["receiving_team_id"])
    if receiving_owner_user_id != responding_user_id:
        raise NotYourTradeError("Only the receiving team's owner can respond to this trade")

    if not accept:
        await conn.execute("UPDATE trades SET status = 'rejected', resolved_at = now() WHERE id = $1", trade_id)
        return await get_trade(conn, trade_id)

    settings = await get_trade_settings(conn, trade["league_id"], trade["season"])
    async with conn.transaction():
        if settings["review_required"]:
            await conn.execute("UPDATE trades SET status = 'awaiting_review' WHERE id = $1", trade_id)
        else:
            await _apply_trade(conn, trade)
            await conn.execute("UPDATE trades SET status = 'accepted', resolved_at = now() WHERE id = $1", trade_id)
    return await get_trade(conn, trade_id)


async def cancel_trade(conn, trade_id: int, user_id: int) -> dict:
    trade = await get_trade(conn, trade_id)
    if trade is None:
        raise TradeNotFoundError(f"Trade {trade_id} not found")
    if trade["status"] != "pending":
        raise TradeNotPendingError("Only a still-pending trade can be cancelled")
    proposing_owner_user_id = await _get_team_owner_user_id(conn, trade["proposing_team_id"])
    if proposing_owner_user_id != user_id:
        raise NotYourTradeError("Only the proposing team's owner can cancel this trade")
    await conn.execute("UPDATE trades SET status = 'cancelled', resolved_at = now() WHERE id = $1", trade_id)
    return await get_trade(conn, trade_id)


async def review_trade(conn, trade_id: int, approve: bool) -> dict:
    """Commissioner-only — enforced by the router (require_league_
    commissioner) before this is ever called."""
    trade = await get_trade(conn, trade_id)
    if trade is None:
        raise TradeNotFoundError(f"Trade {trade_id} not found")
    if trade["status"] != "awaiting_review":
        raise TradeNotAwaitingReviewError(f"This trade isn't awaiting review (status: {trade['status']})")
    async with conn.transaction():
        if approve:
            await _apply_trade(conn, trade)
            await conn.execute("UPDATE trades SET status = 'accepted', resolved_at = now() WHERE id = $1", trade_id)
        else:
            await conn.execute("UPDATE trades SET status = 'vetoed', resolved_at = now() WHERE id = $1", trade_id)
    return await get_trade(conn, trade_id)
