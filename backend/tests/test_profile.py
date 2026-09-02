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
    """Every endpoint in profile.py now requires real active-league
    membership (require_league_access, 2026-09 audit) — this used to
    be fully public, no auth at all."""
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-profile-router-{suffix}@example.com", f"Test Profile {suffix}",
        )
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "member")
    return _session_cookie(user_id)


async def _non_member_cookies(pool, suffix: str) -> dict:
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-profile-router-nonmember-{suffix}@example.com", f"Test Profile NonMember {suffix}",
        )
    return _session_cookie(user_id)


async def _get(path, cookies=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.get(path)


async def _seed_owner_and_team(pool, suffix, display_name, team_name, season=TEST_SEASON):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-profile-owner-{suffix}", display_name,
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            season, 200 + suffix, owner_id, team_name,
        )
    return owner_id, team_id


async def test_profile_endpoints_require_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    assert (await _get("/owners")).status_code == 401
    assert (await _get(f"/owners/1/profile?season={TEST_SEASON}")).status_code == 401
    assert (await _get("/owners/1/career")).status_code == 401
    assert (await _get("/owners/1/badges")).status_code == 401


async def test_profile_endpoints_reject_non_member(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _non_member_cookies(pool, "reject")
    assert (await _get("/owners", cookies)).status_code == 409
    assert (await _get(f"/owners/1/profile?season={TEST_SEASON}", cookies)).status_code == 409
    assert (await _get("/owners/1/career", cookies)).status_code == 409
    assert (await _get("/owners/1/badges", cookies)).status_code == 409


async def test_season_profile_splits_regular_and_playoff(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a, team_a = await _seed_owner_and_team(pool, 1, "Alice", "Team Alpha")
    _, team_b = await _seed_owner_and_team(pool, 2, "Bob", "Team Beta")
    cookies = await _member_cookies(pool, "regular-playoff")

    async with pool.acquire() as conn:
        # regular season: 1 win
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 1, $2, $3, 120.0, 100.0, FALSE)",
            TEST_SEASON, team_a, team_b,
        )
        # regular season: 1 loss
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 2, $2, $3, 90.0, 110.0, FALSE)",
            TEST_SEASON, team_a, team_b,
        )
        # playoff win — should NOT affect the "regular" bucket
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 15, $2, $3, 130.0, 100.0, TRUE)",
            TEST_SEASON, team_a, team_b,
        )

    resp = await _get(f"/owners/{owner_a}/profile?season={TEST_SEASON}", cookies)
    assert resp.status_code == 200
    body = resp.json()

    assert body["regular"]["record"] == "1-1"
    assert body["regular"]["pf"] == 210.0
    assert body["playoff"]["record"] == "1-0"
    assert body["playoff"]["pf"] == 130.0
    assert body["best_week"] == {"week": 1, "score": 120.0}
    assert body["worst_week"] == {"week": 2, "score": 90.0}


async def test_season_profile_404_for_owner_with_no_team(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _member_cookies(pool, "404-no-team")
    resp = await _get(f"/owners/999999999/profile?season={TEST_SEASON}", cookies)
    assert resp.status_code == 404


async def test_season_profile_includes_season_awards(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a, team_a = await _seed_owner_and_team(pool, 6, "Faye", "Faye's Team")
    _, team_b = await _seed_owner_and_team(pool, 7, "Gus", "Gus's Team")
    cookies = await _member_cookies(pool, "season-awards")

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 1, $2, $3, 120.0, 100.0, FALSE)",
            TEST_SEASON, team_a, team_b,
        )
        await conn.execute(
            "INSERT INTO season_awards (season, owner_id, award_type, detail) VALUES ($1, $2, 'Boom Week', '120.0 pts')",
            TEST_SEASON, owner_a,
        )
        # A different season's award for the same owner should NOT show up.
        # A fake year, same reasoning as TEST_SEASON in conftest.py — never
        # a real league season, so this can't collide with real data even
        # though this insert isn't scoped by the autouse cleanup fixture.
        await conn.execute(
            "INSERT INTO season_awards (season, owner_id, award_type, detail) VALUES (1899, $1, 'Old Award', 'irrelevant')",
            owner_a,
        )

    resp = await _get(f"/owners/{owner_a}/profile?season={TEST_SEASON}", cookies)
    assert resp.status_code == 200
    body = resp.json()
    assert body["season_awards"] == [{"award_type": "Boom Week", "detail": "120.0 pts"}]

    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM season_awards WHERE season = 1899 AND owner_id = $1", owner_a)


async def test_career_profile_aggregates_across_seasons(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _member_cookies(pool, "career-aggregate")
    # Fake years (not TEST_SEASON) since this test needs two distinct
    # seasons — see conftest.py's TEST_SEASON comment for why these can
    # never be real-looking years like 2023/2024.
    owner_a, team_a_1901 = await _seed_owner_and_team(pool, 3, "Carl", "Carl's 1901 Team", season=1901)
    async with pool.acquire() as conn:
        team_a_1902 = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES (1902, 203, $1, 'Carl 1902') RETURNING id",
            owner_a,
        )
        opp_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ('test-profile-owner-opp', 'Opp') RETURNING owner_id",
        )
        opp_team_1901 = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES (1901, 210, $1, 'Opp 1901') RETURNING id",
            opp_id,
        )
        opp_team_1902 = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES (1902, 211, $1, 'Opp 1902') RETURNING id",
            opp_id,
        )
        # 1901: win
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES (1901, 1, $1, $2, 100.0, 90.0, FALSE)",
            team_a_1901, opp_team_1901,
        )
        # 1902: loss
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES (1902, 1, $1, $2, 80.0, 95.0, FALSE)",
            team_a_1902, opp_team_1902,
        )
        cleanup_ids = [team_a_1901, team_a_1902, opp_team_1901, opp_team_1902]

    resp = await _get(f"/owners/{owner_a}/career", cookies)
    assert resp.status_code == 200
    body = resp.json()
    assert body["seasons"] == [1901, 1902]
    assert body["regular"]["record"] == "1-1"
    assert body["best_season"]["season"] == 1901
    assert body["worst_season"]["season"] == 1902

    # manual cleanup — these seasons aren't TEST_SEASON, so the autouse
    # fixture's season-scoped cleanup won't catch them
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM matchups WHERE home_team_id = ANY($1) OR away_team_id = ANY($1)", cleanup_ids)
        await conn.execute("DELETE FROM teams_by_season WHERE id = ANY($1)", cleanup_ids)
        await conn.execute("DELETE FROM owners WHERE espn_member_id = 'test-profile-owner-opp'")


async def test_owner_badges_groups_awards_by_type(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_a, _ = await _seed_owner_and_team(pool, 4, "Dana", "Dana's Team")
    cookies = await _member_cookies(pool, "badges")

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO season_champions (season, owner_id, team_name) VALUES ($1, $2, 'Dana Champs')",
            TEST_SEASON, owner_a,
        )
        await conn.execute(
            "INSERT INTO season_awards (season, owner_id, award_type, detail) VALUES ($1, $2, 'Clutch Performer', '4 clutch weeks')",
            TEST_SEASON, owner_a,
        )

    resp = await _get(f"/owners/{owner_a}/badges", cookies)
    assert resp.status_code == 200
    body = resp.json()
    assert body["championship_years"] == [TEST_SEASON]
    assert body["award_summary"] == {"Clutch Performer": [TEST_SEASON]}


async def test_list_all_owners_not_scoped_to_one_season(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _member_cookies(pool, "list-all-owners")
    # Explicit requirement: the owner-card grid includes everyone who's
    # ever been in the league, not just current-season teams — so an
    # owner whose only team was in an old season must still show up.
    owner_id, team_1901 = await _seed_owner_and_team(pool, 5, "Erin", "Erin 1901 Squad", season=1901)
    async with pool.acquire() as conn:
        team_1902 = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES (1902, 305, $1, 'Erin 1902 Squad') RETURNING id",
            owner_id,
        )
        cleanup_ids = [team_1901, team_1902]

    resp = await _get("/owners", cookies)
    assert resp.status_code == 200
    owners_by_id = {o["owner_id"]: o for o in resp.json()["owners"]}

    assert owner_id in owners_by_id
    entry = owners_by_id[owner_id]
    assert entry["display_name"] == "Erin"
    assert entry["latest_team_name"] == "Erin 1902 Squad"  # most recent season, not first
    assert entry["seasons"] == [1901, 1902]

    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM teams_by_season WHERE id = ANY($1)", cleanup_ids)
