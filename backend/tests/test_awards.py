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


async def _commissioner_cookies(pool, suffix: str) -> dict:
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-awards-router-commish-{suffix}@example.com", f"Test Awards Commish {suffix}",
        )
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "commissioner")
    return _session_cookie(user_id)


def _mock_week_final(monkeypatch, target_week):
    """Weekly recap eligibility (narrative_engine._resolve_weekly_kind)
    now checks the target week's own real game data directly instead of
    league_state.current_week's own rollover (2026-09-15 fix — see that
    module's docstring) — this fakes ESPN's public scoreboard call to
    say the given week is fully done. Real ESPN call signature is
    get_week_scoreboard(week=..., year=...) — the fake's first param
    must be named `week` to match, not something else, or the real
    keyword call raises TypeError."""

    async def fake(week, year, season_type=2):
        return [{"completed": True, "state": "post"}] if week == target_week else []

    monkeypatch.setattr("app.domain.narrative_engine.get_week_scoreboard", fake)


async def _get(path, cookies=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.get(path)


async def _post(path, cookies=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.post(path)


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


async def test_weekly_recap_get_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/5/recap")
    assert resp.status_code == 401


async def test_weekly_recap_get_is_null_when_nothing_generated_yet(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    _mock_week_final(monkeypatch, 5)
    cookies = await _member_cookies(pool, "recap-get-null")

    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/5/recap", cookies)
    assert resp.status_code == 200
    assert resp.json() == {"narrative": None}


async def test_weekly_recap_get_returns_cached_narrative(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    _mock_week_final(monkeypatch, 5)
    cookies = await _member_cookies(pool, "recap-get-cached")

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO weekly_narratives (season, week, league_id, kind, text, model) "
            "VALUES ($1, 5, $2, 'recap', $3, 'test-model')",
            TEST_SEASON, DEFAULT_LEAGUE_ID, "A real cached weekly recap.",
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/weeks/5/recap", cookies)
    assert resp.status_code == 200
    assert resp.json() == {"narrative": {"text": "A real cached weekly recap.", "kind": "recap"}}


async def test_weekly_recap_generate_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    resp = await _post(f"/seasons/{TEST_SEASON}/weeks/5/recap/generate")
    assert resp.status_code == 401


async def test_weekly_recap_generate_requires_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _member_cookies(pool, "recap-generate-non-commish")

    resp = await _post(f"/seasons/{TEST_SEASON}/weeks/5/recap/generate", cookies)
    assert resp.status_code == 403


async def test_weekly_recap_generate_as_commissioner_fills_and_returns_narratives(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setattr(
        "app.domain.narrative_engine.generate_narrative",
        lambda system_prompt, facts, max_tokens=300: "Real generated text.",
    )
    monkeypatch.setattr("app.domain.narrative_engine.ANTHROPIC_API_KEY", "fake-key-for-tests")

    week = 5
    _mock_week_final(monkeypatch, week)
    owner_a, team_a = await _seed_owner_and_team(pool, 900, "Jerry", "Jerry's Team")
    owner_b, team_b = await _seed_owner_and_team(pool, 901, "Kelly", "Kelly's Team")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, $2, $3, $4, 110, 95, FALSE)",
            TEST_SEASON, week, team_a, team_b,
        )
    cookies = await _commissioner_cookies(pool, "recap-generate-commish")

    resp = await _post(f"/seasons/{TEST_SEASON}/weeks/{week}/recap/generate", cookies)
    assert resp.status_code == 200
    body = resp.json()
    assert body["weekly_narrative"] == {"text": "Real generated text.", "kind": "recap"}
    assert len(body["matchup_narratives"]) == 1
    assert list(body["matchup_narratives"].values())[0] == "Real generated text."

    # A plain read afterward picks up the now-cached result without regenerating.
    get_resp = await _get(f"/seasons/{TEST_SEASON}/weeks/{week}/recap", cookies)
    assert get_resp.json() == {"narrative": {"text": "Real generated text.", "kind": "recap"}}
