"""Commissioner corrections for a chug that really was done in time but
didn't get credited: waiving one week's MNF doubling
(POST /chug/standing/{id}/waive-doubling) and posting a chug video on
another owner's behalf (POST /chug/upload?owner_id=...). The upload
tests mock run_chug_analysis, same as test_chug_upload.py."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.domain.chug_leaderboard import build_chug_leaderboard
from app.domain.chug_standing import waive_deadline_doubling
from app.main import app
from app.queries import leagues as league_queries
from tests.conftest import TEST_SEASON, make_safe_session_user_id_for_owner

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_DISCORD_USER_ID = 434343


@pytest.fixture(autouse=True)
def _no_real_chug_roast(monkeypatch):
    """A successful upload now asks Claude for a short write-up (app/
    domain/chug_roast.py). Never make a real, billed API call from the
    test suite — the write-up itself is tested in test_chug_roast.py."""
    async def _no_roast(facts):
        return None

    monkeypatch.setattr("app.domain.chug_roast.write_roast", _no_roast)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _seed_owner(pool, suffix, discord_user_id=None):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, discord_user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            f"test-chugcorrect-owner-{suffix}", f"Owner {suffix}", discord_user_id,
        )


async def _cookies(pool, owner_id: int, role: str) -> dict:
    user_id = await make_safe_session_user_id_for_owner(pool, owner_id)
    async with pool.acquire() as conn:
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, role)
    token = create_session_token(
        _SESSION_SECRET, user_id=user_id, owner_id=owner_id, discord_user_id=None, is_commissioner=False,
    )
    return {"session": token}


async def _seed_doubled_week(pool, owner_id, week=1, owed_before=1, outstanding=2, missed=1):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, outstanding_owed, consecutive_missed_weeks) "
            "VALUES ($1, $2, $3, $4)",
            TEST_SEASON, owner_id, outstanding, missed,
        )
        await conn.execute(
            "INSERT INTO chug_deadline_settlements (season, week, owner_id, owed_before, action, owed_after) "
            "VALUES ($1, $2, $3, $4, 'doubled', $5)",
            TEST_SEASON, week, owner_id, owed_before, owed_before * 2,
        )


async def _standing(pool, owner_id):
    async with pool.acquire() as conn:
        return await conn.fetchrow(
            "SELECT outstanding_owed, consecutive_missed_weeks FROM chug_standing WHERE season = $1 AND owner_id = $2",
            TEST_SEASON, owner_id,
        )


async def test_waive_reverses_exactly_what_the_doubling_added(pool):
    owner_id = await _seed_owner(pool, 1)
    # week 1 doubled 1 -> 2, and they've since picked up 3 more from week 2
    await _seed_doubled_week(pool, owner_id, owed_before=1, outstanding=5, missed=1)

    async with pool.acquire() as conn:
        assert await waive_deadline_doubling(conn, TEST_SEASON, 1, owner_id) == 1
        # can't be waived twice
        assert await waive_deadline_doubling(conn, TEST_SEASON, 1, owner_id) == 0
        settlement = await conn.fetchrow(
            "SELECT action, owed_after FROM chug_deadline_settlements WHERE season = $1 AND owner_id = $2",
            TEST_SEASON, owner_id,
        )

    standing = await _standing(pool, owner_id)
    assert standing["outstanding_owed"] == 4
    assert standing["consecutive_missed_weeks"] == 0
    assert settlement["action"] == "waived"
    assert settlement["owed_after"] == 1


async def test_waive_ignores_weeks_that_were_not_doubled(pool):
    owner_id = await _seed_owner(pool, 2)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, outstanding_owed) VALUES ($1, $2, 0)", TEST_SEASON, owner_id
        )
        await conn.execute(
            "INSERT INTO chug_deadline_settlements (season, week, owner_id, owed_before, action, owed_after) "
            "VALUES ($1, 1, $2, 0, 'no_debt', 0)",
            TEST_SEASON, owner_id,
        )
        assert await waive_deadline_doubling(conn, TEST_SEASON, 1, owner_id) == 0


async def test_leaderboard_lists_only_unwaived_doubled_weeks(pool):
    owner_id = await _seed_owner(pool, 3)
    await _seed_doubled_week(pool, owner_id, week=1, owed_before=2, outstanding=4)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed) VALUES ($1, 1, $2, 2)", TEST_SEASON, owner_id
        )
        rows = await build_chug_leaderboard(conn, TEST_SEASON, None)
        row = next(r for r in rows if r["owner_id"] == owner_id)
        assert row["doubled_weeks"] == [{"week": 1, "owed_before": 2, "owed_after": 4}]

        await waive_deadline_doubling(conn, TEST_SEASON, 1, owner_id)
        rows = await build_chug_leaderboard(conn, TEST_SEASON, None)
        row = next(r for r in rows if r["owner_id"] == owner_id)
        assert row["doubled_weeks"] == []


async def test_waive_endpoint_is_commissioner_only(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    target = await _seed_owner(pool, 4)
    await _seed_doubled_week(pool, target)
    member = await _seed_owner(pool, 5)

    async with _client() as client:
        client.cookies.update(await _cookies(pool, member, "member"))
        resp = await client.post(f"/chug/standing/{target}/waive-doubling?week=1")
    assert resp.status_code == 403
    assert (await _standing(pool, target))["outstanding_owed"] == 2


async def test_waive_endpoint_as_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    target = await _seed_owner(pool, 6)
    await _seed_doubled_week(pool, target)
    commish = await _seed_owner(pool, 7)

    async with _client() as client:
        client.cookies.update(await _cookies(pool, commish, "commissioner"))
        resp = await client.post(f"/chug/standing/{target}/waive-doubling?week=1")
    assert resp.status_code == 200
    assert resp.json()["waived"] == 1
    assert (await _standing(pool, target))["outstanding_owed"] == 1


async def _seed_team(pool, owner_id):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
            "VALUES ($1, $2, $3, 'Test Team', $4)",
            TEST_SEASON, 9000 + owner_id % 1000, owner_id, DEFAULT_LEAGUE_ID,
        )


async def test_commissioner_upload_on_behalf_credits_that_owner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))

    async def fake_analysis(path):
        return {
            "can_to_mouth": True, "duration_seconds": 9.67, "time_score": 5.33, "jitter": 0.4,
            "smoothness_score": 5.6, "audio_energy": 0.14, "hype_score": 1.7, "final": 4.69,
        }

    monkeypatch.setattr("app.routers.chug.run_chug_analysis", fake_analysis)
    monkeypatch.setattr("app.routers.chug.chug_storage.chug_storage_configured", lambda: False)

    target = await _seed_owner(pool, 8, discord_user_id=_DISCORD_USER_ID)
    await _seed_team(pool, target)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, outstanding_owed) VALUES ($1, $2, 1)", TEST_SEASON, target
        )
    commish = await _seed_owner(pool, 9, discord_user_id=_DISCORD_USER_ID + 1)

    try:
        async with _client() as client:
            client.cookies.update(await _cookies(pool, commish, "commissioner"))
            resp = await client.post(
                f"/chug/upload?owner_id={target}", files={"video": ("clip.mov", b"fake", "video/quicktime")}
            )
        body = resp.json()
        assert body["can_to_mouth"] is True
        assert body["chugs_owed_before"] == 1
        assert body["chugs_owed_after"] == 0

        async with pool.acquire() as conn:
            credited_to = await conn.fetchval(
                "SELECT discord_user_id FROM chug_scores WHERE id = $1", body["id"]
            )
        assert credited_to == _DISCORD_USER_ID
    finally:
        async with pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM chug_scores WHERE discord_user_id = ANY($1::bigint[])",
                [_DISCORD_USER_ID, _DISCORD_USER_ID + 1],
            )


async def test_upload_on_behalf_rejects_non_commissioner_before_analysis(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))

    async def must_not_run(path):
        raise AssertionError("analysis should not run for a rejected on-behalf upload")

    monkeypatch.setattr("app.routers.chug.run_chug_analysis", must_not_run)
    target = await _seed_owner(pool, 10, discord_user_id=_DISCORD_USER_ID)
    member = await _seed_owner(pool, 11)

    async with _client() as client:
        client.cookies.update(await _cookies(pool, member, "member"))
        resp = await client.post(
            f"/chug/upload?owner_id={target}", files={"video": ("clip.mov", b"fake", "video/quicktime")}
        )
    body = resp.json()
    assert body["error"] is True
    assert body["status"] == 403
