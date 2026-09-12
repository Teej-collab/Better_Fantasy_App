from datetime import datetime
from zoneinfo import ZoneInfo

from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.domain.chug_deadline import get_mnf_deadline, is_past_mnf_deadline
from app.main import app
from app.queries import leagues as league_queries
from tests.conftest import TEST_SEASON

ET = ZoneInfo("America/New_York")
_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"

# A real Monday in the test data's timeframe — 2026-08-24 is a Monday.
_MONDAY_GAME = {
    "name": "Seattle Seahawks at Tennessee Titans",
    "date": "2026-08-25T00:15Z",  # 8:15 PM ET Monday
}
_THURSDAY_GAME = {
    "name": "Las Vegas Raiders at Houston Texans",
    "date": "2026-08-21T00:00Z",  # 8:00 PM ET Thursday
}


def test_get_mnf_deadline_uses_real_kickoff_when_a_monday_game_exists():
    now = datetime(2026, 8, 24, 12, 0, tzinfo=ET)  # Monday midday
    deadline = get_mnf_deadline([_THURSDAY_GAME, _MONDAY_GAME], now)
    assert deadline == datetime(2026, 8, 24, 20, 15, tzinfo=ET)


def test_get_mnf_deadline_falls_back_when_no_monday_game_in_scoreboard():
    now = datetime(2026, 8, 24, 12, 0, tzinfo=ET)
    deadline = get_mnf_deadline([_THURSDAY_GAME], now)  # no Monday game at all
    assert deadline == datetime(2026, 8, 24, 20, 15, tzinfo=ET)  # fallback slot


def test_is_past_mnf_deadline_false_before_kickoff():
    now = datetime(2026, 8, 24, 19, 0, tzinfo=ET)  # Monday, before 8:15 PM
    assert is_past_mnf_deadline([_MONDAY_GAME], now) is False


def test_is_past_mnf_deadline_true_after_kickoff():
    now = datetime(2026, 8, 24, 23, 0, tzinfo=ET)  # Monday night, after kickoff
    assert is_past_mnf_deadline([_MONDAY_GAME], now) is True


def test_is_past_mnf_deadline_true_once_the_week_is_over():
    now = datetime(2026, 8, 26, 9, 0, tzinfo=ET)  # Wednesday — definitely past
    assert is_past_mnf_deadline([_MONDAY_GAME], now) is True


def test_deadline_anchors_to_the_monday_of_the_current_week_regardless_of_weekday():
    # Checking on a Saturday should still compute that same week's Monday.
    now = datetime(2026, 8, 22, 10, 0, tzinfo=ET)  # Saturday
    deadline = get_mnf_deadline([_MONDAY_GAME], now)
    assert deadline.date().isoformat() == "2026-08-24"


async def _member_cookies(pool, suffix: str) -> dict:
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-chug-deadline-router-{suffix}@example.com", f"Test ChugDeadline {suffix}",
        )
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "member")
    return {"session": create_session_token(_SESSION_SECRET, user_id=user_id)}


async def _make_test_owner(pool, suffix: str) -> int:
    """A real, dedicated owners row (espn_member_id LIKE 'test-%', same
    convention cleanup_test_season's own owner cleanup already matches
    on) — not `SELECT owner_id FROM owners LIMIT 1`, which grabs
    whatever row happens to sort first out of every owner in the
    database, test or real. That's a real risk, not just untidy: a
    chug_debts row seeded for the wrong (real) owner_id is exactly the
    kind of test data that doesn't get cleaned up by this file's own
    season-scoped teardown, and league_queries.add_member alone (what
    _member_cookies above uses) never creates an owners row at all —
    only joining a league as a mapped team does that in the real app."""
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-chug-deadline-owner-{suffix}@example.com", f"Test ChugOwner {suffix}",
        )
        return await conn.fetchval(
            "INSERT INTO owners (user_id, display_name, espn_member_id) VALUES ($1, $2, $3) RETURNING owner_id",
            user_id, f"Test ChugOwner {suffix}", f"test-chug-deadline-owner-{suffix}",
        )


async def test_deadline_endpoint_returns_real_kickoff_once_a_chug_is_owed(pool, monkeypatch):
    # 2026-09-12 fix, real report: the endpoint used to compute and
    # return a real kickoff-based deadline every week of the season,
    # including before Week 1 had even finished — a member could see a
    # live countdown days before anyone could possibly owe a chug yet.
    # It now checks chug_debts directly, so this test has to put a real
    # row there first, the same way an actual assigned chug would.
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))

    async def fake_scoreboard():
        return [_MONDAY_GAME]

    monkeypatch.setattr("app.routers.chug.get_nfl_scoreboard", fake_scoreboard)
    cookies = await _member_cookies(pool, "returns-kickoff")
    # The endpoint only checks whether ANY chug_debts row exists for
    # this season/league — not that it belongs to the requesting member
    # — so a separate dedicated test owner (not the member who's about
    # to call the endpoint) is fine here.
    owner_id = await _make_test_owner(pool, "returns-kickoff")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed, league_id) VALUES ($1, 1, $2, 1, $3)",
            TEST_SEASON, owner_id, DEFAULT_LEAGUE_ID,
        )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.update(cookies)
        resp = await client.get("/chug/deadline")

    assert resp.status_code == 200
    body = resp.json()
    assert body["deadline"]
    assert isinstance(body["is_past"], bool)


async def test_deadline_endpoint_returns_null_before_any_chug_is_owed(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))

    async def fake_scoreboard():
        return [_MONDAY_GAME]

    monkeypatch.setattr("app.routers.chug.get_nfl_scoreboard", fake_scoreboard)
    # No chug_debts row inserted at all — the season's Week 1 hasn't
    # finished yet, so nothing is owed by anyone.
    cookies = await _member_cookies(pool, "returns-null")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.update(cookies)
        resp = await client.get("/chug/deadline")

    assert resp.status_code == 200
    body = resp.json()
    assert body["deadline"] is None
    assert body["is_past"] is False


async def test_deadline_endpoint_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/chug/deadline")
    assert resp.status_code == 401
