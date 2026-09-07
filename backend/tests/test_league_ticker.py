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
    """/seasons/{s}/weeks/{w}/ticker now requires real active-league
    membership (require_league_access, 2026-09 audit)."""
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-ticker-router-{suffix}@example.com", f"Test Ticker {suffix}",
        )
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "member")
    return _session_cookie(user_id)


async def _get(path, cookies=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.get(path)


async def _seed_two_teams(pool, season=TEST_SEASON):
    async with pool.acquire() as conn:
        owner_a = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-ticker-owner-a", "Alice Smith",
        )
        owner_b = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-ticker-owner-b", "Bob Jones",
        )
        team_a = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            season, 301, owner_a, "Team Alpha",
        )
        team_b = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            season, 302, owner_b, "Team Beta",
        )
    return team_a, team_b


async def test_ticker_endpoint_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/5/ticker")
    assert resp.status_code == 401


async def test_ticker_picks_highest_scoring_starter_and_excludes_bench(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, team_b = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "highest-scoring")
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 5, $2, $3, 45.5, 30.0, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )
        # A lower-scoring starter and a higher-scoring bench player — the
        # bench player's bigger day must NOT win "top scorer" for the
        # week, since it never actually counted toward the score.
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, pro_team, is_draftable) "
            "VALUES ('test-ticker-starter-guy', 'Starter Guy', 'RB', 'KC', TRUE)"
        )
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, pro_team, is_draftable) "
            "VALUES ('test-ticker-bench-bomber', 'Bench Bomber', 'WR', 'SF', TRUE)"
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, 'test-ticker-starter-guy', 'RB', 'draft')",
            TEST_SEASON, team_a,
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, 'test-ticker-bench-bomber', 'BE', 'draft')",
            TEST_SEASON, team_a,
        )
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, 5, 'test-ticker-starter-guy', '{}', 22.5)",
            TEST_SEASON,
        )
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, 5, 'test-ticker-bench-bomber', '{}', 40.0)",
            TEST_SEASON,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/5/ticker", cookies)
    assert resp.status_code == 200
    body = resp.json()
    assert body["season"] == TEST_SEASON
    assert body["week"] == 5
    assert len(body["items"]) == 1

    item = body["items"][0]
    assert item["home_team_name"] == "Team Alpha"
    assert item["home_score"] == 45.5
    assert item["home_top_scorer"] == {"player_name": "Starter Guy", "points_scored": 22.5}
    assert item["away_team_name"] == "Team Beta"
    assert item["away_score"] == 30.0
    assert item["away_top_scorer"] is None  # no roster rows seeded for team_b


async def test_ticker_empty_week_returns_empty_list(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _member_cookies(pool, "empty-week")
    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/16/ticker", cookies)
    assert resp.status_code == 200
    assert resp.json()["items"] == []


async def test_ticker_excludes_unplayed_matchup_with_zero_zero_score(pool, monkeypatch):
    # ESPN represents an unplayed matchup as a real 0/0, not NULL — same
    # "not actually played yet" convention get_standings/get_head_to_head
    # already exclude on. The ticker is specifically "this week's live
    # scores," so an unplayed matchup should never appear in it at all
    # (2026-09-02 audit: it used to, reading as fake "0.0 vs 0.0" under a
    # "Live" label).
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, team_b = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "excludes-unplayed")
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 6, $2, $3, 0, 0, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/6/ticker", cookies)
    assert resp.status_code == 200
    assert resp.json()["items"] == []


async def test_ticker_mixed_week_shows_only_started_matchups(pool, monkeypatch):
    # A real Sunday: some games have kicked off, some haven't yet. Only
    # the started matchup's own segment should appear — the unplayed one
    # is silently omitted rather than showing as 0.0-0.0.
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, team_b = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "mixed-week")
    async with pool.acquire() as conn:
        owner_c = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-ticker-owner-c", "Cara Lee",
        )
        owner_d = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-ticker-owner-d", "Dan Cho",
        )
        team_c = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 303, owner_c, "Team Gamma",
        )
        team_d = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 304, owner_d, "Team Delta",
        )
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 7, $2, $3, 12.4, 9.1, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 7, $2, $3, 0, 0, FALSE)
            """,
            TEST_SEASON, team_c, team_d,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/7/ticker", cookies)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["home_team_name"] == "Team Alpha"
    assert body["items"][0]["home_score"] == 12.4
