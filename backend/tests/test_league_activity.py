import itertools

from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.domain.league_activity import get_league_activity
from app.main import app
from app.queries import leagues as league_queries
from app.queries.roster_transactions import log_transaction
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_espn_team_ids = itertools.count(930000)


async def _member_cookies(pool, suffix: str) -> dict:
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-activity-router-{suffix}@example.com", f"Test Activity {suffix}",
        )
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "member")
    return {"session": create_session_token(_SESSION_SECRET, user_id=user_id)}


async def _seed_owner_with_team(pool, suffix):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-activity-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, next(_espn_team_ids), owner_id, f"Team {suffix}",
        )
    return owner_id, team_id


async def _seed_player(pool, suffix, position="RB"):
    sleeper_id = f"test-activity-player-{suffix}"
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable)
            VALUES ($1, $2, $3, $4, 'KC', 'Active', TRUE)
            """,
            sleeper_id, f"Test Player {suffix}", position, [position],
        )
    return sleeper_id


async def _seed_accepted_trade(pool, proposing_team_id, receiving_team_id, give_player_id, receive_player_id):
    async with pool.acquire() as conn:
        trade_id = await conn.fetchval(
            """
            INSERT INTO trades (league_id, season, proposing_team_id, receiving_team_id, status, resolved_at)
            VALUES ($1, $2, $3, $4, 'accepted', now())
            RETURNING id
            """,
            DEFAULT_LEAGUE_ID, TEST_SEASON, proposing_team_id, receiving_team_id,
        )
        await conn.execute(
            "INSERT INTO trade_assets (trade_id, sleeper_player_id, from_team_id, to_team_id) VALUES ($1, $2, $3, $4)",
            trade_id, give_player_id, proposing_team_id, receiving_team_id,
        )
        await conn.execute(
            "INSERT INTO trade_assets (trade_id, sleeper_player_id, from_team_id, to_team_id) VALUES ($1, $2, $3, $4)",
            trade_id, receive_player_id, receiving_team_id, proposing_team_id,
        )
    return trade_id


async def test_get_league_activity_merges_roster_moves_and_trades_newest_first(pool):
    _, team_a = await _seed_owner_with_team(pool, "merge-a")
    _, team_b = await _seed_owner_with_team(pool, "merge-b")
    added = await _seed_player(pool, "merge-added")
    dropped = await _seed_player(pool, "merge-dropped")
    give_player = await _seed_player(pool, "merge-give")
    receive_player = await _seed_player(pool, "merge-receive")

    async with pool.acquire() as conn:
        await log_transaction(conn, TEST_SEASON, team_a, source="waiver", added_sleeper_player_id=added)
        await log_transaction(conn, TEST_SEASON, team_a, source="free_agent", dropped_sleeper_player_id=dropped)
    await _seed_accepted_trade(pool, team_a, team_b, give_player, receive_player)

    async with pool.acquire() as conn:
        items = await get_league_activity(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, limit=30)

    relevant_names = {"Team merge-a", "Team merge-b"}
    kinds = {
        item["kind"]
        for item in items
        if item.get("team_name") in relevant_names
        or item.get("proposing_team_name") in relevant_names
        or item.get("receiving_team_name") in relevant_names
    }
    assert "roster" in kinds
    assert "trade" in kinds

    # Every item this test seeded, newest-first — every subsequent
    # item's timestamp should be <= the one before it.
    relevant = [
        i for i in items
        if i["kind"] == "trade" or i.get("owner_name", "").startswith("Owner merge")
    ]
    timestamps = [i["timestamp"] for i in relevant]
    assert timestamps == sorted(timestamps, reverse=True)


async def test_get_league_activity_roster_item_carries_player_and_team_names(pool):
    _, team_id = await _seed_owner_with_team(pool, "shape")
    added = await _seed_player(pool, "shape-added", position="WR")

    async with pool.acquire() as conn:
        await log_transaction(conn, TEST_SEASON, team_id, source="free_agent", added_sleeper_player_id=added)
        items = await get_league_activity(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, limit=30)

    mine = [i for i in items if i["kind"] == "roster" and i["team_name"] == "Team shape"]
    assert len(mine) == 1
    assert mine[0]["added_player_name"] == "Test Player shape-added"
    assert mine[0]["added_position"] == "WR"
    assert mine[0]["dropped_player_name"] is None
    assert mine[0]["source"] == "free_agent"


async def test_get_league_activity_trade_item_carries_both_sides(pool):
    _, team_a = await _seed_owner_with_team(pool, "trade-a")
    _, team_b = await _seed_owner_with_team(pool, "trade-b")
    give_player = await _seed_player(pool, "trade-give")
    receive_player = await _seed_player(pool, "trade-receive")
    await _seed_accepted_trade(pool, team_a, team_b, give_player, receive_player)

    async with pool.acquire() as conn:
        items = await get_league_activity(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, limit=30)

    mine = [
        i for i in items
        if i["kind"] == "trade" and i["proposing_team_name"] == "Team trade-a"
    ]
    assert len(mine) == 1
    trade = mine[0]
    assert trade["receiving_team_name"] == "Team trade-b"
    player_names = {a["player_name"] for a in trade["assets"]}
    assert player_names == {"Test Player trade-give", "Test Player trade-receive"}


async def test_get_league_activity_respects_the_limit(pool):
    _, team_id = await _seed_owner_with_team(pool, "limit")
    async with pool.acquire() as conn:
        for i in range(5):
            player_id = await _seed_player(pool, f"limit-{i}")
            await log_transaction(conn, TEST_SEASON, team_id, source="free_agent", added_sleeper_player_id=player_id)
        items = await get_league_activity(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, limit=3)

    assert len(items) <= 3


async def test_activity_endpoint_returns_items_for_a_real_member(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    _, team_id = await _seed_owner_with_team(pool, "router")
    player_id = await _seed_player(pool, "router")
    async with pool.acquire() as conn:
        await log_transaction(conn, TEST_SEASON, team_id, source="free_agent", added_sleeper_player_id=player_id)

    cookies = await _member_cookies(pool, "router")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.update(cookies)
        resp = await client.get(f"/seasons/{TEST_SEASON}/activity")

    assert resp.status_code == 200
    body = resp.json()
    mine = [i for i in body["items"] if i.get("team_name") == "Team router"]
    assert len(mine) == 1
    assert mine[0]["added_player_name"] == "Test Player router"


async def test_activity_endpoint_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/seasons/{TEST_SEASON}/activity")
    assert resp.status_code == 401
