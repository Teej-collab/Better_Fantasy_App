from httpx import ASGITransport, AsyncClient

from app.main import app


async def test_health_returns_ok():
    # httpx.AsyncClient + ASGITransport, not fastapi.testclient.TestClient —
    # TestClient runs the app in its own thread with its own event loop,
    # which breaks the asyncpg pool singleton (app/db.py) shared with the
    # other async tests running on pytest-asyncio's session-scoped loop.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
