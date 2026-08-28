from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _session_cookie(owner_id: int, is_commissioner: bool):
    token = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=owner_id, discord_user_id=900000 + owner_id, is_commissioner=is_commissioner
    )
    return {"session": token}


async def _post_sync(cookies=None, path="/admin/sync"):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.post(path)


async def test_sync_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync()
    assert response.status_code == 401


async def test_sync_rejects_non_commissioner(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(cookies=_session_cookie(1, is_commissioner=False))
    assert response.status_code == 403


async def test_live_sync_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(path="/admin/sync/live")
    assert response.status_code == 401


async def test_live_sync_rejects_non_commissioner(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(cookies=_session_cookie(1, is_commissioner=False), path="/admin/sync/live")
    assert response.status_code == 403


async def test_weekly_compute_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(path="/admin/weekly-compute")
    assert response.status_code == 401


async def test_weekly_compute_rejects_non_commissioner(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(cookies=_session_cookie(1, is_commissioner=False), path="/admin/weekly-compute")
    assert response.status_code == 403


async def test_bye_week_sync_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(path="/admin/sync/bye-weeks")
    assert response.status_code == 401


async def test_bye_week_sync_rejects_non_commissioner(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(cookies=_session_cookie(1, is_commissioner=False), path="/admin/sync/bye-weeks")
    assert response.status_code == 403


async def test_bye_week_sync_writes_real_rows(pool, monkeypatch):
    from app.domain import bye_weeks as bye_weeks_module
    from tests.conftest import TEST_SEASON

    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    monkeypatch.setenv("ESPN_LEAGUE_ID", "2027626914")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "{00000000-FAKE-0000-FAKE-000000000000}")

    async def fake_scoreboard(week, year, season_type=None):
        return [{"home_team": "KC", "away_team": "SF"}] if week == 1 else [{"home_team": "SF", "away_team": "ZZZ"}]

    monkeypatch.setattr(bye_weeks_module, "get_week_scoreboard", fake_scoreboard)
    monkeypatch.setattr(bye_weeks_module, "REGULAR_SEASON_WEEKS", 2)

    response = await _post_sync(cookies=_session_cookie(1, is_commissioner=True), path="/admin/sync/bye-weeks")

    assert response.status_code == 200
    body = response.json()
    assert body["teams_synced"] == 1  # only KC has exactly one missing week in this fixture
