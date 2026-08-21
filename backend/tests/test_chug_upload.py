"""
Upload endpoint tests mock app.routers.chug.run_chug_analysis — the
real mediapipe/moviepy pipeline only runs in the dedicated venv311
environment (requirements-chug-analyzer.txt) and is never invoked from
this test suite's Python 3.13 environment, same "never the real thing
in CI" discipline as the ESPN write tests.
"""
import os

from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_DISCORD_USER_ID = 424242


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _session_cookie(owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=owner_id, discord_user_id=_DISCORD_USER_ID, is_commissioner=False
    )
    return {"session": token}


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, discord_user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            f"test-chugupload-owner-{suffix}", f"Uploader {suffix}", _DISCORD_USER_ID,
        )


async def _cleanup(pool, season=TEST_SEASON):
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM chug_scores WHERE discord_user_id = $1", _DISCORD_USER_ID)
        await conn.execute("DELETE FROM league_state WHERE season = $1", season)


async def test_upload_requires_session(pool):
    async with _client() as client:
        resp = await client.post("/chug/upload", files={"video": ("clip.mp4", b"fake", "video/mp4")})
    assert resp.status_code == 401


async def test_upload_rejects_unsupported_extension(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 1)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/chug/upload", files={"video": ("clip.txt", b"not a video", "text/plain")})

    assert resp.status_code == 400


async def test_upload_rejects_oversized_file(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setattr("app.routers.chug.MAX_UPLOAD_BYTES", 10)
    owner_id = await _seed_owner(pool, 2)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post(
            "/chug/upload", files={"video": ("clip.mp4", b"x" * 1000, "video/mp4")}
        )

    assert resp.status_code == 413


async def test_upload_no_contact_detected_does_not_save_a_score(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 3)

    async def fake_analysis(video_path):
        assert os.path.exists(video_path)  # the temp file is real while analysis runs
        return {"can_to_mouth": False, "final": 0.0}

    monkeypatch.setattr("app.routers.chug.run_chug_analysis", fake_analysis)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/chug/upload", files={"video": ("clip.mp4", b"fake video bytes", "video/mp4")})

    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM chug_scores WHERE discord_user_id = $1", _DISCORD_USER_ID)
    await _cleanup(pool)

    assert resp.status_code == 200
    assert resp.json()["can_to_mouth"] is False
    assert len(rows) == 0


async def test_upload_successful_analysis_saves_score_and_cleans_up_temp_file(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    owner_id = await _seed_owner(pool, 4)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_state (season, current_week) VALUES ($1, 2) "
            "ON CONFLICT (season) DO UPDATE SET current_week = EXCLUDED.current_week",
            TEST_SEASON,
        )

    captured_path = {}

    async def fake_analysis(video_path):
        captured_path["path"] = video_path
        return {
            "can_to_mouth": True,
            "duration_seconds": 1.8,
            "time_score": 10,
            "jitter": 0.05,
            "smoothness_score": 9.5,
            "audio_energy": 0.6,
            "hype_score": 7.2,
            "final": 9.06,
        }

    monkeypatch.setattr("app.routers.chug.run_chug_analysis", fake_analysis)

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/chug/upload", files={"video": ("clip.mov", b"fake video bytes", "video/quicktime")})

    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM chug_scores WHERE discord_user_id = $1", _DISCORD_USER_ID)
    await _cleanup(pool)

    assert resp.status_code == 200
    body = resp.json()
    assert body["can_to_mouth"] is True
    assert body["final_score"] == 9.06
    assert body["duration_seconds"] == 1.8

    assert row is not None
    assert row["season"] == TEST_SEASON
    assert row["week"] == 2
    assert float(row["final_score"]) == 9.06

    # the temp file the analyzer was handed must not survive the request
    assert not os.path.exists(captured_path["path"])

    # nothing was owed (no chug_standing row seeded) -> the "for funsies"
    # case, no debt effect either side of the upload.
    assert body["chugs_owed_before"] == 0
    assert body["chugs_owed_after"] == 0


async def _fake_analysis(video_path):
    return {
        "can_to_mouth": True,
        "duration_seconds": 2.0,
        "time_score": 8.0,
        "smoothness_score": 8.0,
        "hype_score": 7.0,
        "final": 8.5,
    }


async def test_upload_with_real_debt_pays_it_down(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    monkeypatch.setattr("app.routers.chug.run_chug_analysis", _fake_analysis)
    owner_id = await _seed_owner(pool, 5)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, outstanding_owed) VALUES ($1, $2, 2)",
            TEST_SEASON, owner_id,
        )

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/chug/upload", files={"video": ("clip.mp4", b"fake video bytes", "video/mp4")})

    await _cleanup(pool)

    assert resp.status_code == 200
    body = resp.json()
    assert body["chugs_owed_before"] == 2
    assert body["chugs_owed_after"] == 1  # paid down by one


async def test_upload_with_nothing_owed_is_for_funsies_and_does_not_bank(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    monkeypatch.setattr("app.routers.chug.run_chug_analysis", _fake_analysis)
    owner_id = await _seed_owner(pool, 6)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, outstanding_owed) VALUES ($1, $2, 0)",
            TEST_SEASON, owner_id,
        )

    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.post("/chug/upload", files={"video": ("clip.mp4", b"fake video bytes", "video/mp4")})

    async with pool.acquire() as conn:
        lifetime = await conn.fetchval(
            "SELECT COUNT(*) FROM chug_scores WHERE discord_user_id = $1", _DISCORD_USER_ID
        )
    await _cleanup(pool)

    assert resp.status_code == 200
    body = resp.json()
    assert body["chugs_owed_before"] == 0
    assert body["chugs_owed_after"] == 0  # never goes negative / doesn't bank
    assert lifetime == 1  # but it's still a real, counted completion
