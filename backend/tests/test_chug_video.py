"""
Tests for chug video storage: the upload flow's real (mocked) bucket
write, GET /chug/feed's per-chug has_video flag, and GET /chug/{id}/video's
presigned-URL exchange + league-membership scoping. Real boto3/Railway
Bucket calls are never made here — app.providers.chug_storage is
monkeypatched the same way run_chug_analysis already is in
test_chug_upload.py, since neither talks to anything real in CI.
"""
from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.main import app
from app.queries import leagues as league_queries
from tests.conftest import TEST_SEASON, make_safe_session_user_id_for_owner

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_DISCORD_USER_ID = 909090


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _session_cookie_for_user(user_id: int) -> dict:
    return {"session": create_session_token(_SESSION_SECRET, user_id=user_id)}


async def _member_cookies(pool, suffix: str) -> dict:
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-chugvideo-{suffix}@example.com", f"Test ChugVideo {suffix}",
        )
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "member")
    return _session_cookie_for_user(user_id)


async def _owner_upload_cookie(pool, owner_id: int):
    return {
        "session": create_session_token(
            _SESSION_SECRET, user_id=await make_safe_session_user_id_for_owner(pool, owner_id), owner_id=owner_id,
            discord_user_id=_DISCORD_USER_ID, is_commissioner=False,
        )
    }


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, discord_user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            f"test-chugvideo-owner-{suffix}", f"Uploader {suffix}", _DISCORD_USER_ID,
        )


async def _cleanup(pool):
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM chug_scores WHERE discord_user_id = $1", _DISCORD_USER_ID)


async def _fake_analysis(video_path):
    return {
        "can_to_mouth": True,
        "duration_seconds": 2.0,
        "time_score": 8.0,
        "smoothness_score": 8.0,
        "hype_score": 7.0,
        "final": 8.5,
    }


async def test_upload_stores_video_key_when_storage_is_configured(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    monkeypatch.setattr("app.routers.chug.run_chug_analysis", _fake_analysis)
    monkeypatch.setattr("app.providers.chug_storage.chug_storage_configured", lambda: True)

    uploaded = {}

    def fake_upload(local_path, key, ext):
        uploaded["key"] = key

    monkeypatch.setattr("app.providers.chug_storage.upload_video", fake_upload)

    owner_id = await _seed_owner(pool, "stores-key")
    async with _client() as client:
        client.cookies.update(await _owner_upload_cookie(pool, owner_id))
        resp = await client.post("/chug/upload", files={"video": ("clip.mp4", b"fake video bytes", "video/mp4")})

    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT video_url FROM chug_scores WHERE discord_user_id = $1", _DISCORD_USER_ID)
    await _cleanup(pool)

    assert resp.status_code == 200
    body = resp.json()
    assert body["has_video"] is True
    assert row["video_url"] == uploaded["key"]


async def test_upload_degrades_gracefully_when_storage_upload_fails(pool, monkeypatch):
    """A storage failure must never block the chug itself from being
    scored and recorded — the grade/debt effect is the part that
    actually matters (see _process_chug_upload's own comment)."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    monkeypatch.setattr("app.routers.chug.run_chug_analysis", _fake_analysis)
    monkeypatch.setattr("app.providers.chug_storage.chug_storage_configured", lambda: True)

    def failing_upload(local_path, key, ext):
        raise RuntimeError("bucket unreachable")

    monkeypatch.setattr("app.providers.chug_storage.upload_video", failing_upload)

    owner_id = await _seed_owner(pool, "upload-fails")
    async with _client() as client:
        client.cookies.update(await _owner_upload_cookie(pool, owner_id))
        resp = await client.post("/chug/upload", files={"video": ("clip.mp4", b"fake video bytes", "video/mp4")})

    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT video_url FROM chug_scores WHERE discord_user_id = $1", _DISCORD_USER_ID)
    await _cleanup(pool)

    assert resp.status_code == 200
    body = resp.json()
    assert body["can_to_mouth"] is True
    assert body["has_video"] is False
    assert row is not None  # the chug was still recorded
    assert row["video_url"] is None


async def test_upload_leaves_no_video_when_storage_not_configured(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    monkeypatch.setattr("app.routers.chug.run_chug_analysis", _fake_analysis)
    monkeypatch.setattr("app.providers.chug_storage.chug_storage_configured", lambda: False)

    owner_id = await _seed_owner(pool, "no-storage")
    async with _client() as client:
        client.cookies.update(await _owner_upload_cookie(pool, owner_id))
        resp = await client.post("/chug/upload", files={"video": ("clip.mp4", b"fake video bytes", "video/mp4")})

    await _cleanup(pool)

    assert resp.status_code == 200
    assert resp.json()["has_video"] is False


async def test_chug_video_returns_404_when_no_video(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, "no-video-404")
    async with pool.acquire() as conn:
        chug_id = await conn.fetchval(
            "INSERT INTO chug_scores (discord_user_id, final_score, season, week, league_id) "
            "VALUES ($1, 5.0, $2, 1, $3) RETURNING id",
            _DISCORD_USER_ID, TEST_SEASON, DEFAULT_LEAGUE_ID,
        )

    async with _client() as client:
        client.cookies.update(await _member_cookies(pool, "no-video-404"))
        resp = await client.get(f"/chug/{chug_id}/video")

    await _cleanup(pool)
    assert resp.status_code == 404


async def test_chug_video_returns_presigned_url_when_video_exists(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setattr(
        "app.providers.chug_storage.presigned_video_url",
        lambda key: f"https://example-bucket.storageapi.dev/{key}?signature=fake",
    )

    owner_id = await _seed_owner(pool, "has-video")
    async with pool.acquire() as conn:
        chug_id = await conn.fetchval(
            "INSERT INTO chug_scores (discord_user_id, final_score, season, week, league_id, video_url) "
            "VALUES ($1, 5.0, $2, 1, $3, 'chug-videos/1/2026/1/abc123.mp4') RETURNING id",
            _DISCORD_USER_ID, TEST_SEASON, DEFAULT_LEAGUE_ID,
        )

    async with _client() as client:
        client.cookies.update(await _member_cookies(pool, "has-video"))
        resp = await client.get(f"/chug/{chug_id}/video")

    await _cleanup(pool)
    assert resp.status_code == 200
    body = resp.json()
    assert body["url"] == "https://example-bucket.storageapi.dev/chug-videos/1/2026/1/abc123.mp4?signature=fake"
    assert body["expires_in"] > 0


async def test_chug_feed_lists_recent_chugs_with_has_video_flag(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, "feed")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_scores (discord_user_id, final_score, season, week, league_id, video_url) "
            "VALUES ($1, 7.5, $2, 3, $3, 'chug-videos/1/2026/3/xyz.mp4')",
            _DISCORD_USER_ID, TEST_SEASON, DEFAULT_LEAGUE_ID,
        )

    async with _client() as client:
        client.cookies.update(await _member_cookies(pool, "feed"))
        # Scoped to TEST_SEASON and matched by owner_id (unique to this
        # test) rather than assuming this row stays within the default
        # LIMIT/25 newest-first window — the shared test DB can easily
        # already hold 25+ other league-1 chug_scores rows from earlier
        # test runs.
        resp = await client.get(f"/chug/feed?season={TEST_SEASON}")

    await _cleanup(pool)
    assert resp.status_code == 200
    chugs = resp.json()["chugs"]
    entry = next(c for c in chugs if c["owner_id"] == owner_id)
    assert entry["has_video"] is True
    assert entry["week"] == 3
