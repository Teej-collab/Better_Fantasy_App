"""Tests for the league kitty, franchise tag fees and the offseason roster
lock (app/domain/kitty.py, app/domain/offseason.py, app/routers/kitty.py)."""
from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.domain import kitty, offseason, trades as trades_domain
from app.main import app
from app.queries import leagues as league_queries
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def test_tag_fee_by_year_kept():
    fees = [0, 10, 25]
    assert kitty.tag_fee(fees, 1) == 0  # year 1 is free
    assert kitty.tag_fee(fees, 2) == 10
    assert kitty.tag_fee(fees, 3) == 25
    assert kitty.tag_fee(fees, 4) == 25  # past the list: the last price
    assert kitty.tag_fee(None, 2) == 0


async def _owner(conn, suffix, role="member"):
    user_id = await conn.fetchval(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
        f"test-kitty-{suffix}@example.com", f"Kitty {suffix}",
    )
    owner_id = await conn.fetchval(
        "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
        f"test-kitty-owner-{suffix}", f"Kitty {suffix}",
    )
    await conn.execute("INSERT INTO owner_users (owner_id, user_id) VALUES ($1, $2)", owner_id, user_id)
    await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, role)
    team_id = await conn.fetchval(
        "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
        TEST_SEASON, 980000 + abs(hash(suffix)) % 9999, owner_id, f"Kitty Team {suffix}",
    )
    return user_id, owner_id, team_id


async def test_locking_keepers_bills_tag_fees_and_unlocking_clears_the_unpaid(pool):
    async with pool.acquire() as conn:
        _, a, _ = await _owner(conn, "a")
        _, b, _ = await _owner(conn, "b")
        await conn.execute(
            "INSERT INTO league_keeper_rules (season, league_id, max_keepers, max_consecutive_years, tag_fees) "
            "VALUES ($1, 1, 1, 3, '[0, 10, 25]'::jsonb)",
            TEST_SEASON,
        )
        for owner, espn, name, year in ((a, 990001, "Year Two Guy", 2), (b, 990002, "Rookie Keeper", 1)):
            await conn.execute(
                "INSERT INTO keeper_selections (season, owner_id, espn_player_id, player_name, consecutive_years_kept, league_id) "
                "VALUES ($1, $2, $3, $4, $5, 1)",
                TEST_SEASON, owner, espn, name, year,
            )
        assert await kitty.lock_keepers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID) is not None
        assert await kitty.lock_keepers(conn, TEST_SEASON, DEFAULT_LEAGUE_ID) is None  # already locked: no double bill
        entries = (await kitty.ledger(conn, DEFAULT_LEAGUE_ID))["entries"]
        mine = [e for e in entries if e["season"] == TEST_SEASON]
        assert [(e["owner_id"], e["amount"], e["reason"]) for e in mine] == [(a, 10.0, "Franchise tag: Year Two Guy (year 2)")]

        await kitty.clear_unpaid_tag_fees(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
        assert not [e for e in (await kitty.ledger(conn, DEFAULT_LEAGUE_ID))["entries"] if e["season"] == TEST_SEASON]


async def test_commissioner_marks_kitty_entries_paid_and_members_can_only_read(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async with pool.acquire() as conn:
        member_user, member, _ = await _owner(conn, "member")
        await conn.execute(
            "INSERT INTO league_kitty_entries (league_id, season, owner_id, amount, reason) VALUES (1, $1, $2, 25, 'Buy-in')",
            TEST_SEASON, member,
        )
        entry_id = await conn.fetchval("SELECT id FROM league_kitty_entries WHERE owner_id = $1", member)
    member_cookie = {"session": create_session_token(_SESSION_SECRET, user_id=member_user, owner_id=member, discord_user_id=300001, is_commissioner=False)}

    async def as_commish(conn, payload):
        return DEFAULT_LEAGUE_ID

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", cookies=member_cookie) as client:
        assert (await client.get("/league/kitty")).status_code == 200
        assert (await client.post(f"/league/kitty/{entry_id}/paid", json={"paid": True})).status_code == 403
        monkeypatch.setattr("app.routers.kitty.require_league_commissioner", as_commish)
        body = (await client.post(f"/league/kitty/{entry_id}/paid", json={"paid": True})).json()
    entry = next(e for e in body["entries"] if e["id"] == entry_id)
    assert entry["paid_at"] is not None
    assert body["collected"] >= 25


async def test_offseason_lock_blocks_pickups_until_cleared(pool):
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ('test-kitty-off@example.com', 'x', 'Off') RETURNING id"
        )
        league_id = await league_queries.create_league(conn, "Test League Offseason", user_id, "OFFSEAS1")
        assert await offseason.pickups_blocked(conn, TEST_SEASON, league_id) is None  # off by default
        await conn.execute("UPDATE leagues SET offseason_lock = TRUE WHERE id = $1", league_id)
        # No draft done yet this season: that's the offseason.
        assert await offseason.pickups_blocked(conn, TEST_SEASON, league_id) == offseason.MESSAGE
        await conn.execute(
            "INSERT INTO draft_config (season, league_id, draft_order, roster_slots, status) VALUES ($1, $2, '{}', '{}'::jsonb, 'complete')",
            TEST_SEASON, league_id,
        )
        assert await offseason.pickups_blocked(conn, TEST_SEASON, league_id) is None  # in season
        await conn.execute("UPDATE leagues SET offseason_cleared_season = $2 WHERE id = $1", league_id, TEST_SEASON)
        await conn.execute("DELETE FROM draft_config WHERE league_id = $1", league_id)
        assert await offseason.pickups_blocked(conn, TEST_SEASON, league_id) is None  # cleared


async def test_a_tagged_player_going_back_to_the_manager_who_kept_him_is_flagged(pool):
    async with pool.acquire() as conn:
        _, keeper, keeper_team = await _owner(conn, "tagger")
        _, other, other_team = await _owner(conn, "holder")
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, espn_player_id) VALUES ('test-kitty-tagged', 'Tagged Guy', 'RB', 990010) "
            "ON CONFLICT (sleeper_player_id) DO NOTHING"
        )
        await conn.execute(
            "INSERT INTO keeper_selections (season, owner_id, espn_player_id, player_name, consecutive_years_kept, league_id) "
            "VALUES ($1, $2, 990010, 'Tagged Guy', 2, 1)",
            TEST_SEASON, keeper,
        )
        trade_id = await conn.fetchval(
            "INSERT INTO trades (league_id, season, proposing_team_id, receiving_team_id) VALUES (1, $1, $2, $3) RETURNING id",
            TEST_SEASON, other_team, keeper_team,
        )
        await conn.execute(
            "INSERT INTO trade_assets (trade_id, sleeper_player_id, from_team_id, to_team_id) VALUES ($1, 'test-kitty-tagged', $2, $3)",
            trade_id, other_team, keeper_team,
        )
        trade = await trades_domain.get_trade(conn, trade_id)
    assert trade["tag_flags"] == [f"Tagged Guy goes back to Kitty Team tagger, who kept him in {TEST_SEASON}"]
