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
    """/awards/all-time now requires real active-league membership
    (require_league_access, 2026-09 audit) — used to be fully public."""
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-alltime-award-router-{suffix}@example.com", f"Test AllTime {suffix}",
        )
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "member")
    return _session_cookie(user_id)

# Like test_records.py, GET /awards/all-time has no season filter at all —
# it spans the league's whole real history, not just TEST_SEASON. Unlike
# records.py's numeric leaderboards (where a single huge fixture value can
# safely dominate any real score), season_awards has a UNIQUE (season,
# award_type) constraint — one owner per award per season, so a test can't
# fabricate an arbitrarily large "win count" for one (season, award_type)
# pair the way test_records.py fabricates one huge score. Instead this
# gives its test owner a real season_awards row in each of several distinct
# fake seasons (TEST_SEASON plus a small dedicated range right next to it,
# also reserved sentinel values — see conftest.py's TEST_SEASON comment for
# why 1900 itself can never collide with a real season) so the count is
# large enough to rank #1 regardless of the real league's actual history,
# and cleans those extra seasons up itself since the shared
# cleanup_test_season fixture only ever scopes to TEST_SEASON exactly.
_EXTRA_SEASONS = range(1901, 1910)  # 9 more seasons, alongside TEST_SEASON (1900) = 10 total


async def _get(path, cookies=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.get(path)


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-alltime-award-owner-{suffix}", f"Owner {suffix}",
        )


async def test_all_time_awards_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    resp = await _get("/awards/all-time")
    assert resp.status_code == 401


async def test_all_time_awards_include_every_award_type_even_with_no_wins(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _member_cookies(pool, "every-type")
    resp = await _get("/awards/all-time", cookies)
    assert resp.status_code == 200
    categories = resp.json()["categories"]
    keys = {c["key"] for c in categories}

    assert "season_champion" in keys
    for award_type in (
        "Clutch Performer", "Choke Artist", "Overachiever", "Underachiever",
        "Boom Week", "Bust Week", "Snakebit Award", "Luckiest Win",
        "Heater", "Cold Streak", "Bullseye Award", "Highway Robbery",
    ):
        assert award_type in keys
    assert len(categories) == 13  # season_champion + the 12 season_awards types

    # Every category is present in the response shape even when nobody in
    # this test run has ever won it — an empty list, not a missing key.
    for c in categories:
        assert isinstance(c["winners"], list)


async def test_all_time_awards_ranks_the_owner_with_the_most_wins_first(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 1)
    cookies = await _member_cookies(pool, "ranks-first")
    try:
        async with pool.acquire() as conn:
            for season in [TEST_SEASON, *_EXTRA_SEASONS]:
                await conn.execute(
                    "INSERT INTO season_awards (season, owner_id, award_type, detail) VALUES ($1, $2, $3, $4)",
                    season, owner_id, "Clutch Performer", "test win",
                )
            for season in [TEST_SEASON, *_EXTRA_SEASONS]:
                await conn.execute(
                    "INSERT INTO season_champions (season, owner_id, team_name) VALUES ($1, $2, $3)",
                    season, owner_id, "Test Champs",
                )

        resp = await _get("/awards/all-time", cookies)
        categories = {c["key"]: c for c in resp.json()["categories"]}

        clutch_winners = categories["Clutch Performer"]["winners"]
        assert clutch_winners[0]["owner_id"] == owner_id
        assert clutch_winners[0]["wins"] == 10

        champ_winners = categories["season_champion"]["winners"]
        assert champ_winners[0]["owner_id"] == owner_id
        assert champ_winners[0]["wins"] == 10
    finally:
        async with pool.acquire() as conn:
            for season in _EXTRA_SEASONS:
                await conn.execute("DELETE FROM season_awards WHERE season = $1", season)
                await conn.execute("DELETE FROM season_champions WHERE season = $1", season)
            # TEST_SEASON (1900) itself is cleaned up by the shared
            # cleanup_test_season autouse fixture, same as every other test.
