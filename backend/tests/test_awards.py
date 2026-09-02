from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.main import app
from app.queries import leagues as league_queries
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _session_cookie(user_id: int) -> dict:
    return {"session": create_session_token(_SESSION_SECRET, user_id=user_id)}


async def _member_cookies(pool, suffix: str) -> dict:
    """awards.py now requires real active-league membership
    (require_league_access, 2026-09 audit) — used to be fully public."""
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-awards-router-{suffix}@example.com", f"Test Awards {suffix}",
        )
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "member")
    return _session_cookie(user_id)


async def _non_member_cookies(pool, suffix: str) -> dict:
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-awards-router-nonmember-{suffix}@example.com", f"Test Awards NonMember {suffix}",
        )
    return _session_cookie(user_id)


async def _get(path, cookies=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.get(path)


async def _seed_owner_and_team(pool, suffix, display_name, team_name):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-awards-owner-{suffix}", display_name,
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 300 + suffix, owner_id, team_name,
        )
    return owner_id, team_id


async def test_awards_endpoints_require_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    assert (await _get(f"/seasons/{TEST_SEASON}/awards")).status_code == 401
    assert (await _get(f"/seasons/{TEST_SEASON}/weeks/1/awards")).status_code == 401
    assert (await _get("/awards/all-time")).status_code == 401
    assert (await _get("/rivalries")).status_code == 401


async def test_awards_endpoints_reject_non_member(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _non_member_cookies(pool, "reject")
    assert (await _get(f"/seasons/{TEST_SEASON}/awards", cookies)).status_code == 409
    assert (await _get(f"/seasons/{TEST_SEASON}/weeks/1/awards", cookies)).status_code == 409
    assert (await _get("/awards/all-time", cookies)).status_code == 409
    assert (await _get("/rivalries", cookies)).status_code == 409


async def test_season_awards_endpoint(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a, _ = await _seed_owner_and_team(pool, 1, "Eve", "Eve's Team")
    cookies = await _member_cookies(pool, "season-endpoint")

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO season_champions (season, owner_id, team_name) VALUES ($1, $2, 'Eve Champs')",
            TEST_SEASON, owner_a,
        )
        await conn.execute(
            "INSERT INTO season_awards (season, owner_id, award_type, detail) VALUES ($1, $2, 'Bench Crime Boss', '5 bench crimes')",
            TEST_SEASON, owner_a,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/awards", cookies)
    assert resp.status_code == 200
    body = resp.json()
    assert body["champion"]["owner_name"] == "Eve"
    assert body["awards"][0]["award_type"] == "Bench Crime Boss"
    assert body["awards"][0]["owner_name"] == "Eve"


async def test_weekly_awards_endpoint(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a, team_a = await _seed_owner_and_team(pool, 2, "Frank", "Frank's Team")
    owner_b, team_b = await _seed_owner_and_team(pool, 3, "Grace", "Grace's Team")
    cookies = await _member_cookies(pool, "weekly-endpoint")
    week = 1

    async with pool.acquire() as conn:
        # Frank massively overachieves (150 vs a 100 projection); Grace melts down.
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, $2, $3, $4, 150.0, 60.0, FALSE)",
            TEST_SEASON, week, team_a, team_b,
        )
        await conn.execute(
            "INSERT INTO weekly_team_stats (season, week, team_id, team_points_projected) VALUES ($1, $2, $3, 100.0)",
            TEST_SEASON, week, team_a,
        )
        await conn.execute(
            "INSERT INTO weekly_team_stats (season, week, team_id, team_points_projected) VALUES ($1, $2, $3, 100.0)",
            TEST_SEASON, week, team_b,
        )
        await conn.execute(
            "INSERT INTO bench_crimes (season, week, team_id, bench_player, started_player, position, points_diff, severity) "
            "VALUES ($1, $2, $3, 'Bench Guy', 'Starter Guy', 'RB', 15.5, 'Major Infraction')",
            TEST_SEASON, week, team_b,
        )
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected, is_boom) "
            "VALUES ($1, $2, $3, 'Boom Guy', 'WR', 'WR', 35.0, 12.0, TRUE)",
            TEST_SEASON, week, team_a,
        )
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected, is_bust) "
            "VALUES ($1, $2, $3, 'Bust Guy', 'RB', 'RB', 1.0, 15.0, TRUE)",
            TEST_SEASON, week, team_b,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/{week}/awards", cookies)
    assert resp.status_code == 200
    body = resp.json()

    assert body["overachiever"]["team_name"] == "Frank's Team"
    assert body["meltdown"]["team_name"] == "Grace's Team"
    assert body["biggest_bench_crime"]["bench_player"] == "Bench Guy"
    assert body["boom_leaders"][0]["player_name"] == "Boom Guy"
    assert body["bust_leaders"][0]["player_name"] == "Bust Guy"
    # Only one matchup exists this week, so it's trivially the "game of
    # the week" once it has power-rank data — but neither team has any
    # weekly_team_stats.power_rank set here, so this should gracefully be None.
    assert body["game_of_the_week"] is None


async def test_rivalries_endpoint(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a, _ = await _seed_owner_and_team(pool, 4, "Hank", "Hank's Team")
    owner_b, _ = await _seed_owner_and_team(pool, 5, "Ivy", "Ivy's Team")
    cookies = await _member_cookies(pool, "rivalries-endpoint")

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO rivalries (owner_a_id, owner_b_id, name, tier) VALUES ($1, $2, 'Test Rivalry', 'Developing')",
            owner_a, owner_b,
        )

    resp = await _get("/rivalries", cookies)
    assert resp.status_code == 200
    names = [r["name"] for r in resp.json()["rivalries"]]
    assert "Test Rivalry" in names
