"""
Auction drafts (league formats, 2026-10). Every team starts with the
same budget (leagues.type_settings.auction_budget, $200 by default).
Teams take turns nominating a player with an opening bid; anyone can
raise; when the clock runs out the high bidder wins him at that price.

The clock is draft_config.current_pick_deadline — the column the snake
draft's 2-second clock job already watches — so tick() is called the
same way autopick() is for a snake draft:
- a nomination clock (NOMINATION_SECONDS): if it runs out, the best
  available player the nominator can roster is nominated for them at
  $1 (or $0 when they're out of money).
- a bid clock (BID_SECONDS), reset by every bid: when it runs out, the
  high bidder wins the player.

Max bid: a team must keep $1 for every other open roster spot, so its
max bid is remaining - (open spots - 1). A team with a full roster
can't bid or nominate, and the nomination skips it. The draft is
complete once every roster is full.

Results land in draft_picks as they're won (pick_number in the order
won, round = that team's nth player, price = what he cost) and in
current_rosters, exactly like a snake pick.
"""
from datetime import datetime, timedelta, timezone

from app.domain.draft_autopick import choose_autopick
from app.domain.draft_exceptions import DraftError, DraftNotInProgressError, PlayerAlreadyDraftedError
from app.domain.roster_slots import total_draftable_slots
from app.queries import draft_queue as draft_queue_queries

NOMINATION_SECONDS = 45
BID_SECONDS = 15


class AuctionError(DraftError):
    """A nomination or bid that isn't allowed right now."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def create_auction(conn, season: int, league_id: int, budget: int) -> None:
    await conn.execute(
        """
        INSERT INTO draft_auction (season, league_id, budget) VALUES ($1, $2, $3)
        ON CONFLICT (season, league_id) DO UPDATE SET budget = EXCLUDED.budget, nomination_index = 0,
            nominator_owner_id = NULL, nominee_sleeper_id = NULL, high_bid = NULL, high_bidder_owner_id = NULL,
            nominated_at = NULL
        """,
        season, league_id, budget,
    )


async def _config(conn, season: int, league_id: int, lock: bool = False) -> dict | None:
    from app.domain.draft_engine import _config_dict

    row = await conn.fetchrow(
        "SELECT * FROM draft_config WHERE season = $1 AND league_id = $2" + (" FOR UPDATE" if lock else ""),
        season, league_id,
    )
    return _config_dict(row) if row else None


async def _auction(conn, season: int, league_id: int, lock: bool = False):
    return await conn.fetchrow(
        "SELECT * FROM draft_auction WHERE season = $1 AND league_id = $2" + (" FOR UPDATE" if lock else ""),
        season, league_id,
    )


def _roster_size(config: dict) -> int:
    return total_draftable_slots(config["roster_slots"])


async def owner_budgets(conn, season: int, league_id: int, config=None, auction=None) -> dict[int, dict]:
    """{owner_id: {spent, remaining, players, open_spots, max_bid}} for
    every team in the draft."""
    config = config or await _config(conn, season, league_id)
    auction = auction or await _auction(conn, season, league_id)
    size = _roster_size(config)
    rows = await conn.fetch(
        """
        SELECT owner_id, COALESCE(SUM(price), 0) AS spent, COUNT(*) AS players FROM draft_picks
        WHERE season = $1 AND league_id = $2 AND sleeper_player_id IS NOT NULL GROUP BY owner_id
        """,
        season, league_id,
    )
    won = {r["owner_id"]: r for r in rows}
    out = {}
    for owner_id in config["draft_order"]:
        spent = int(won[owner_id]["spent"]) if owner_id in won else 0
        players = int(won[owner_id]["players"]) if owner_id in won else 0
        remaining = auction["budget"] - spent
        open_spots = max(0, size - players)
        out[owner_id] = {
            "spent": spent,
            "remaining": remaining,
            "players": players,
            "open_spots": open_spots,
            "max_bid": max(0, remaining - (open_spots - 1)) if open_spots > 0 else 0,
        }
    return out


async def _advance_nomination(conn, season: int, league_id: int, config, auction, start_index: int):
    """Hands the nomination to the next team (from start_index, wrapping)
    with an open roster spot, or completes the draft when there's none."""
    budgets = await owner_budgets(conn, season, league_id, config, auction)
    order = list(config["draft_order"])
    for step in range(len(order)):
        index = start_index + step
        owner_id = order[index % len(order)]
        if budgets[owner_id]["open_spots"] > 0:
            await conn.execute(
                """
                UPDATE draft_auction SET nomination_index = $3, nominator_owner_id = $4, nominee_sleeper_id = NULL,
                    high_bid = NULL, high_bidder_owner_id = NULL, nominated_at = NULL
                WHERE season = $1 AND league_id = $2
                """,
                season, league_id, index, owner_id,
            )
            await conn.execute(
                "UPDATE draft_config SET current_pick_deadline = $3 WHERE season = $1 AND league_id = $2",
                season, league_id, _now() + timedelta(seconds=NOMINATION_SECONDS),
            )
            return
    await conn.execute(
        """
        UPDATE draft_auction SET nominator_owner_id = NULL, nominee_sleeper_id = NULL, high_bid = NULL,
            high_bidder_owner_id = NULL WHERE season = $1 AND league_id = $2
        """,
        season, league_id,
    )
    await conn.execute(
        "UPDATE draft_config SET status = 'complete', completed_at = now(), current_pick_deadline = NULL "
        "WHERE season = $1 AND league_id = $2",
        season, league_id,
    )


async def start(conn, season: int, league_id: int) -> None:
    """Called by draft_engine.start_draft once the draft is in progress."""
    config = await _config(conn, season, league_id)
    auction = await _auction(conn, season, league_id)
    await _advance_nomination(conn, season, league_id, config, auction, 0)


async def _available(conn, season: int, league_id: int, sleeper_player_id: str) -> bool:
    taken = await conn.fetchval(
        """
        SELECT 1 WHERE EXISTS (SELECT 1 FROM draft_picks WHERE season = $1 AND league_id = $2 AND sleeper_player_id = $3)
                    OR EXISTS (SELECT 1 FROM current_rosters WHERE season = $1 AND league_id = $2 AND sleeper_player_id = $3)
        """,
        season, league_id, sleeper_player_id,
    )
    return not taken


async def nominate(conn, season: int, league_id: int, owner_id: int, sleeper_player_id: str, bid: int) -> None:
    from app.domain.draft_engine import is_draftable_in_league

    async with conn.transaction():
        config = await _config(conn, season, league_id, lock=True)
        auction = await _auction(conn, season, league_id, lock=True)
        if config is None or config["status"] != "in_progress" or auction is None:
            raise DraftNotInProgressError("The auction isn't running")
        if auction["nominee_sleeper_id"] is not None:
            raise AuctionError("A player is already up for bid")
        if auction["nominator_owner_id"] != owner_id:
            raise AuctionError("It isn't your turn to nominate")
        if not await is_draftable_in_league(conn, season, league_id, sleeper_player_id):
            raise AuctionError("That player can't be drafted here")
        if not await _available(conn, season, league_id, sleeper_player_id):
            raise PlayerAlreadyDraftedError("That player has already been won")
        budget = (await owner_budgets(conn, season, league_id, config, auction))[owner_id]
        if bid < 0 or bid > budget["max_bid"]:
            raise AuctionError(f"Your max bid is ${budget['max_bid']}")
        await conn.execute(
            """
            UPDATE draft_auction SET nominee_sleeper_id = $3, high_bid = $4, high_bidder_owner_id = $5, nominated_at = now()
            WHERE season = $1 AND league_id = $2
            """,
            season, league_id, sleeper_player_id, bid, owner_id,
        )
        await conn.execute(
            "UPDATE draft_config SET current_pick_deadline = $3 WHERE season = $1 AND league_id = $2",
            season, league_id, _now() + timedelta(seconds=BID_SECONDS),
        )


async def bid(conn, season: int, league_id: int, owner_id: int, amount: int) -> None:
    async with conn.transaction():
        config = await _config(conn, season, league_id, lock=True)
        auction = await _auction(conn, season, league_id, lock=True)
        if config is None or config["status"] != "in_progress" or auction is None or auction["nominee_sleeper_id"] is None:
            raise AuctionError("Nobody is up for bid right now")
        if config["current_pick_deadline"] is not None and config["current_pick_deadline"] <= _now():
            raise AuctionError("Bidding on this player just closed")
        if auction["high_bidder_owner_id"] == owner_id:
            raise AuctionError("You already have the high bid")
        if amount <= (auction["high_bid"] or 0):
            raise AuctionError(f"Bid more than ${auction['high_bid']}")
        budget = (await owner_budgets(conn, season, league_id, config, auction)).get(owner_id)
        if budget is None or budget["open_spots"] == 0:
            raise AuctionError("Your roster is full")
        if amount > budget["max_bid"]:
            raise AuctionError(f"Your max bid is ${budget['max_bid']}")
        await conn.execute(
            "UPDATE draft_auction SET high_bid = $3, high_bidder_owner_id = $4 WHERE season = $1 AND league_id = $2",
            season, league_id, amount, owner_id,
        )
        await conn.execute(
            "UPDATE draft_config SET current_pick_deadline = $3 WHERE season = $1 AND league_id = $2",
            season, league_id, _now() + timedelta(seconds=BID_SECONDS),
        )


async def tick(conn, season: int, league_id: int) -> dict | None:
    """The clock ran out: award the player up for bid, or nominate for
    a nominator who let the clock run. Returns what happened."""
    from app.domain.draft_engine import draftable_pool

    async with conn.transaction():
        config = await _config(conn, season, league_id, lock=True)
        auction = await _auction(conn, season, league_id, lock=True)
        if config is None or config["status"] != "in_progress" or auction is None:
            return None
        if config["current_pick_deadline"] is None or config["current_pick_deadline"] > _now():
            return None

        if auction["nominee_sleeper_id"] is not None:
            winner = auction["high_bidder_owner_id"]
            player_id = auction["nominee_sleeper_id"]
            price = auction["high_bid"] or 0
            pick_number = (await conn.fetchval(
                "SELECT COALESCE(MAX(pick_number), 0) FROM draft_picks WHERE season = $1 AND league_id = $2",
                season, league_id,
            )) + 1
            players = await conn.fetchval(
                "SELECT COUNT(*) FROM draft_picks WHERE season = $1 AND league_id = $2 AND owner_id = $3",
                season, league_id, winner,
            )
            await conn.execute(
                """
                INSERT INTO draft_picks (season, pick_number, round, round_pick, owner_id, sleeper_player_id,
                                         is_autopick, made_at, league_id, price)
                VALUES ($1, $2, $3, $4, $5, $6, FALSE, now(), $7, $8)
                """,
                # round = this team's nth player, round_pick = the team's
                # draft-order seat, so the draft board lays an auction out
                # as one column per team.
                season, pick_number, players + 1, list(config["draft_order"]).index(winner) + 1,
                winner, player_id, league_id, price,
            )
            team_id = await conn.fetchval(
                "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2 AND league_id = $3",
                season, winner, league_id,
            )
            await conn.execute(
                "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id) "
                "VALUES ($1, $2, $3, 'BE', 'draft', $4)",
                season, team_id, player_id, league_id,
            )
            await draft_queue_queries.remove_player_from_all_queues(conn, season, player_id, league_id)
            await conn.execute(
                "UPDATE draft_config SET current_pick_number = $3 WHERE season = $1 AND league_id = $2",
                season, league_id, pick_number + 1,
            )
            await _advance_nomination(conn, season, league_id, config, auction, auction["nomination_index"] + 1)
            return {"event": "won", "owner_id": winner, "sleeper_player_id": player_id, "price": price}

        nominator = auction["nominator_owner_id"]
        if nominator is None:
            return None
        budget = (await owner_budgets(conn, season, league_id, config, auction))[nominator]
        team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2 AND league_id = $3",
            season, nominator, league_id,
        )
        rostered = [r["position"] for r in await conn.fetch(
            "SELECT p.position FROM current_rosters cr JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id "
            "WHERE cr.season = $1 AND cr.team_id = $2",
            season, team_id,
        )]
        queue = await draft_queue_queries.get_queue(conn, season, nominator, league_id)
        chosen = choose_autopick(
            rostered, config["roster_slots"], await draftable_pool(conn, season, league_id), config.get("position_max"),
            queue,
        )
        if chosen is None:
            await _advance_nomination(conn, season, league_id, config, auction, auction["nomination_index"] + 1)
            return {"event": "skipped", "owner_id": nominator}
        opening = min(1, budget["max_bid"])
        await conn.execute(
            """
            UPDATE draft_auction SET nominee_sleeper_id = $3, high_bid = $4, high_bidder_owner_id = $5, nominated_at = now()
            WHERE season = $1 AND league_id = $2
            """,
            season, league_id, chosen["sleeper_player_id"], opening, nominator,
        )
        await conn.execute(
            "UPDATE draft_config SET current_pick_deadline = $3 WHERE season = $1 AND league_id = $2",
            season, league_id, _now() + timedelta(seconds=BID_SECONDS),
        )
        return {"event": "auto_nominated", "owner_id": nominator, "sleeper_player_id": chosen["sleeper_player_id"]}


async def get_state(conn, season: int, league_id: int) -> dict | None:
    """The live auction for the draft room: who's nominating, who's up
    and the high bid, and every team's money."""
    auction = await _auction(conn, season, league_id)
    if auction is None:
        return None
    config = await _config(conn, season, league_id)
    budgets = await owner_budgets(conn, season, league_id, config, auction)
    nominee = None
    if auction["nominee_sleeper_id"]:
        p = await conn.fetchrow(
            "SELECT sleeper_player_id, full_name, position, pro_team FROM players WHERE sleeper_player_id = $1",
            auction["nominee_sleeper_id"],
        )
        nominee = dict(p) if p else {"sleeper_player_id": auction["nominee_sleeper_id"]}
    return {
        "budget": auction["budget"],
        "nominator_owner_id": auction["nominator_owner_id"],
        "nominee": nominee,
        "high_bid": auction["high_bid"],
        "high_bidder_owner_id": auction["high_bidder_owner_id"],
        "deadline": config["current_pick_deadline"],
        "teams": [{"owner_id": oid, **b} for oid, b in budgets.items()],
    }


async def undo_last(conn, season: int, league_id: int) -> dict | None:
    """Gives back the last player won: off the roster, money refunded
    (his pick row goes), and the nomination returns to that turn."""
    async with conn.transaction():
        last = await conn.fetchrow(
            "SELECT * FROM draft_picks WHERE season = $1 AND league_id = $2 AND made_at IS NOT NULL "
            "AND is_keeper = FALSE ORDER BY made_at DESC LIMIT 1",
            season, league_id,
        )
        if last is None:
            return None
        await conn.execute(
            "DELETE FROM current_rosters WHERE season = $1 AND league_id = $2 AND sleeper_player_id = $3",
            season, league_id, last["sleeper_player_id"],
        )
        await conn.execute("DELETE FROM draft_picks WHERE id = $1", last["id"])
        config = await _config(conn, season, league_id)
        auction = await _auction(conn, season, league_id)
        await conn.execute(
            "UPDATE draft_config SET status = 'in_progress', completed_at = NULL WHERE season = $1 AND league_id = $2",
            season, league_id,
        )
        await _advance_nomination(conn, season, league_id, config, auction, max(0, auction["nomination_index"] - 1))
        return dict(last)
