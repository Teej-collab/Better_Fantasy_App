from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.domain.streaks import compute_streak, get_team_streaks
from app.main import app
from app.queries import leagues as league_queries
from app.queries.league import get_head_to_head, get_rivalry_for_owners
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _session_cookie(user_id: int) -> dict:
    return {"session": create_session_token(_SESSION_SECRET, user_id=user_id)}


async def _member_cookies(pool, suffix: str) -> dict:
    """/seasons/{s}/weeks/{w}/matchup-context now requires real
    active-league membership (require_league_access, 2026-09 audit)."""
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-mc-router-{suffix}@example.com", f"Test MatchupContext {suffix}",
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
            "test-mc-owner-a", "Alice Smith",
        )
        owner_b = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-mc-owner-b", "Bob Jones",
        )
        team_a = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            season, 201, owner_a, "Team Alpha",
        )
        team_b = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            season, 202, owner_b, "Team Beta",
        )
    return owner_a, owner_b, team_a, team_b


def test_compute_streak_hot_cold_neutral():
    assert compute_streak([True, True, True]) == "hot"
    assert compute_streak([False, False, False]) == "cold"
    assert compute_streak([True, False, True]) == "neutral"
    assert compute_streak([False, True, True, True]) == "hot"  # only last 3 count
    assert compute_streak([True, True]) == "neutral"  # fewer than 3 games


async def test_get_team_streaks_batched(pool):
    owner_a, owner_b, team_a, team_b = await _seed_two_teams(pool)
    async with pool.acquire() as conn:
        for week, (a_score, b_score) in enumerate([(120, 100), (110, 90), (105, 80)], start=1):
            await conn.execute(
                """
                INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
                VALUES ($1, $2, $3, $4, $5, $6, FALSE)
                """,
                TEST_SEASON, week, team_a, team_b, a_score, b_score,
            )

    streaks = await get_team_streaks(pool, TEST_SEASON, [team_a, team_b])
    assert streaks[team_a] == "hot"  # won all 3
    assert streaks[team_b] == "cold"  # lost all 3


async def test_get_head_to_head_counts_wins_and_excludes_unplayed(pool):
    owner_a, owner_b, team_a, team_b = await _seed_two_teams(pool)
    async with pool.acquire() as conn:
        # Week 1: team_a (home) beats team_b (away) — owner_a win.
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 1, $2, $3, 120, 100, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )
        # Week 2: team_a (home) loses to team_b (away) — owner_b win.
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 2, $2, $3, 80, 95, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )
        # Unplayed (0-0) — must not count.
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 3, $2, $3, 0, 0, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )

    async with pool.acquire() as conn:
        h2h = await get_head_to_head(conn, owner_a, owner_b)
    assert h2h["wins_a"] == 1  # week 1
    assert h2h["wins_b"] == 1  # week 2
    assert h2h["ties"] == 0
    assert h2h["last_season"] == TEST_SEASON
    assert h2h["last_week"] == 2
    assert [g["winner"] for g in h2h["recent_games"]] == ["a", "b"]  # unplayed excluded, oldest first


async def test_get_head_to_head_recent_games_capped_at_five(pool):
    owner_a, owner_b, team_a, team_b = await _seed_two_teams(pool)
    async with pool.acquire() as conn:
        for week in range(1, 8):  # 7 played games
            await conn.execute(
                """
                INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
                VALUES ($1, $2, $3, $4, 100, 90, FALSE)
                """,
                TEST_SEASON, week, team_a, team_b,
            )
        h2h = await get_head_to_head(conn, owner_a, owner_b)
    assert h2h["wins_a"] == 7
    assert len(h2h["recent_games"]) == 5
    assert [g["week"] for g in h2h["recent_games"]] == [3, 4, 5, 6, 7]  # most recent 5, oldest first


async def test_get_rivalry_for_owners_matches_either_order(pool):
    owner_a, owner_b, _, _ = await _seed_two_teams(pool)
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO rivalries (owner_a_id, owner_b_id, all_time_wins_a, all_time_wins_b, name, emoji, tagline, description, tier)
            VALUES ($1, $2, 5, 3, 'The Rumble', '\U0001f94a', 'tagline', 'description', 'gold')
            """,
            owner_a, owner_b,
        )
        found_forward = await get_rivalry_for_owners(conn, owner_a, owner_b)
        found_reversed = await get_rivalry_for_owners(conn, owner_b, owner_a)
    assert found_forward["name"] == "The Rumble"
    assert found_reversed["name"] == "The Rumble"


async def test_get_rivalry_for_owners_none_when_not_curated(pool):
    owner_a, owner_b, _, _ = await _seed_two_teams(pool)
    async with pool.acquire() as conn:
        found = await get_rivalry_for_owners(conn, owner_a, owner_b)
    assert found is None


async def test_matchup_context_endpoint_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/5/matchup-context")
    assert resp.status_code == 401


async def test_matchup_context_endpoint_shape_without_rivalry(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a, owner_b, team_a, team_b = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "shape-no-rivalry")
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 5, $2, $3, 120.5, 100.0, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, pro_team, is_draftable, projected_avg_points) "
            "VALUES ('test-mc-starter-guy', 'Starter Guy', 'RB', 'KC', TRUE, 18.0)"
        )
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, pro_team, is_draftable, projected_avg_points) "
            "VALUES ('test-mc-bench-guy', 'Bench Guy', 'WR', 'SF', TRUE, 9.0)"
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, 'test-mc-starter-guy', 'RB', 'draft')",
            TEST_SEASON, team_a,
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, 'test-mc-bench-guy', 'BE', 'draft')",
            TEST_SEASON, team_a,
        )
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, 5, 'test-mc-starter-guy', '{}', 20.5)",
            TEST_SEASON,
        )
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, 5, 'test-mc-bench-guy', '{}', 10.0)",
            TEST_SEASON,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/5/matchup-context", cookies)
    assert resp.status_code == 200
    body = resp.json()
    assert body["season"] == TEST_SEASON
    assert body["week"] == 5
    assert len(body["matchups"]) == 1

    m = body["matchups"][0]
    assert m["is_rivalry"] is False
    assert m["rivalry"] is None
    assert m["narrative"] is None
    # The matchup itself is already played (real, non-zero scores) —
    # it's correctly counted in its own head-to-head history, same as
    # any other completed game between these two owners would be.
    assert m["head_to_head"]["wins_home"] == 1
    assert m["home"]["team_name"] == "Team Alpha"
    assert m["home"]["projected_total"] == 18.0  # bench excluded from projected total
    assert [p["player_name"] for p in m["home"]["roster"]] == ["Starter Guy", "Bench Guy"]
    assert m["home"]["roster"][0]["player_id"] == "test-mc-starter-guy"
    assert m["home"]["roster"][0]["pro_team"] == "KC"
    assert m["home"]["roster"][1]["player_id"] == "test-mc-bench-guy"


async def test_matchup_context_includes_each_side_s_own_power_rank(pool, monkeypatch):
    # 2026-09-17 addition: the Standings-style #N badge now also shows
    # in the matchup header — null for a team with no ranked week yet,
    # a real number once one exists, per side independently.
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a, owner_b, team_a, team_b = await _seed_two_teams(pool, season=TEST_SEASON)
    cookies = await _member_cookies(pool, "power-rank")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 6, $2, $3, 0, 0, FALSE)",
            TEST_SEASON, team_a, team_b,
        )
        await conn.execute(
            "INSERT INTO weekly_team_stats (season, week, team_id, power_rank) VALUES ($1, 6, $2, 2)",
            TEST_SEASON, team_a,
        )
        # team_b deliberately has no weekly_team_stats row at all.

    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/6/matchup-context", cookies)
    assert resp.status_code == 200
    m = resp.json()["matchups"][0]
    assert m["home"]["power_rank"] == 2
    assert m["away"]["power_rank"] is None


async def test_matchup_context_flags_rivalry_with_correct_home_away_orientation(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a, owner_b, team_a, team_b = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "flags-rivalry")
    async with pool.acquire() as conn:
        # owner_a is rivalry's "a" side with 5 wins; team_a (owner_a) is HOME here.
        await conn.execute(
            """
            INSERT INTO rivalries (owner_a_id, owner_b_id, all_time_wins_a, all_time_wins_b, name, emoji, tagline, description, tier)
            VALUES ($1, $2, 5, 3, 'The Rumble', '\U0001f94a', 'tagline', 'description', 'gold')
            """,
            owner_a, owner_b,
        )
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 6, $2, $3, 120.5, 100.0, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/6/matchup-context", cookies)
    m = resp.json()["matchups"][0]
    assert m["is_rivalry"] is True
    assert m["rivalry"]["name"] == "The Rumble"
    assert m["rivalry"]["all_time_wins_home"] == 5  # home (team_a) is owner_a
    assert m["rivalry"]["all_time_wins_away"] == 3


async def test_matchup_context_includes_recent_meetings_oriented_to_home(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a, owner_b, team_a, team_b = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "recent-meetings")
    async with pool.acquire() as conn:
        # Week 1: team_a (home) wins.
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 1, $2, $3, 110, 90, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )
        # Week 7: the matchup being displayed — team_a (home) loses.
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 7, $2, $3, 80, 100, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/7/matchup-context", cookies)
    m = resp.json()["matchups"][0]
    meetings = m["head_to_head"]["recent_meetings"]
    assert [g["week"] for g in meetings] == [1, 7]
    assert meetings[0]["home_won"] is True
    assert meetings[1]["home_won"] is False
    assert all(g["tie"] is False for g in meetings)
    assert meetings[0]["home_score"] == 110.0 and meetings[0]["away_score"] == 90.0
    assert meetings[1]["home_score"] == 80.0 and meetings[1]["away_score"] == 100.0


async def test_matchup_context_empty_week_returns_empty_list(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _member_cookies(pool, "empty-week")
    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/16/matchup-context", cookies)
    assert resp.status_code == 200
    assert resp.json()["matchups"] == []
