from httpx import ASGITransport, AsyncClient

from app.main import app


async def _post_sync(headers=None, path="/admin/sync"):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post(path, headers=headers or {})


async def test_sync_disabled_when_token_not_configured(monkeypatch):
    monkeypatch.delenv("ADMIN_SYNC_TOKEN", raising=False)
    response = await _post_sync()
    assert response.status_code == 501


async def test_sync_rejects_wrong_token(monkeypatch):
    monkeypatch.setenv("ADMIN_SYNC_TOKEN", "correct-token")
    response = await _post_sync(headers={"X-Admin-Token": "wrong-token"})
    assert response.status_code == 403


async def test_sync_rejects_missing_token_header(monkeypatch):
    monkeypatch.setenv("ADMIN_SYNC_TOKEN", "correct-token")
    response = await _post_sync()
    assert response.status_code == 403


async def test_live_sync_disabled_when_token_not_configured(monkeypatch):
    monkeypatch.delenv("ADMIN_SYNC_TOKEN", raising=False)
    response = await _post_sync(path="/admin/sync/live")
    assert response.status_code == 501


async def test_live_sync_rejects_wrong_token(monkeypatch):
    monkeypatch.setenv("ADMIN_SYNC_TOKEN", "correct-token")
    response = await _post_sync(headers={"X-Admin-Token": "wrong-token"}, path="/admin/sync/live")
    assert response.status_code == 403
