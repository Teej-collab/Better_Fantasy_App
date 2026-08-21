from httpx import ASGITransport, AsyncClient

from app.main import app


async def _get():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get("/game-day")


async def test_game_day_true_when_a_real_game_is_live(monkeypatch):
    async def fake_scoreboard():
        return [{"state": "pre"}, {"state": "in"}]

    monkeypatch.setattr("app.routers.game_day.get_nfl_scoreboard", fake_scoreboard)
    resp = await _get()
    assert resp.status_code == 200
    assert resp.json() == {"is_game_day": True}


async def test_game_day_false_when_nothing_is_live(monkeypatch):
    async def fake_scoreboard():
        return [{"state": "pre"}, {"state": "post"}]

    monkeypatch.setattr("app.routers.game_day.get_nfl_scoreboard", fake_scoreboard)
    resp = await _get()
    assert resp.json() == {"is_game_day": False}
