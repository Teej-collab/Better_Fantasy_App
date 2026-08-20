from httpx import ASGITransport, AsyncClient

from app.main import app


async def _get():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get("/game-day")


async def test_game_day_true_during_a_window(monkeypatch):
    monkeypatch.setattr("app.routers.game_day.is_within_nfl_game_window", lambda: True)
    resp = await _get()
    assert resp.status_code == 200
    assert resp.json() == {"is_game_day": True}


async def test_game_day_false_outside_a_window(monkeypatch):
    monkeypatch.setattr("app.routers.game_day.is_within_nfl_game_window", lambda: False)
    resp = await _get()
    assert resp.json() == {"is_game_day": False}
