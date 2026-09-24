"""AI chug write-ups (app/domain/chug_roast.py). The Anthropic call is
always mocked — never a real, billed request from the test suite."""
import asyncio

from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.domain import chug_roast
from app.main import app
from app.queries import leagues as league_queries
from tests.conftest import TEST_SEASON, make_safe_session_user_id_for_owner

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_DISCORD_A = 515151
_DISCORD_B = 525252

_RESULT = {
    "can_to_mouth": True, "duration_seconds": 9.67, "time_score": 5.33, "jitter": 0.4,
    "smoothness_score": 5.6, "audio_energy": 0.14, "hype_score": 1.7, "final": 4.69,
}


async def _seed_owner(pool, suffix, discord_user_id):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, discord_user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            f"test-chugroast-owner-{suffix}", f"Roast {suffix}", discord_user_id,
        )


async def _cleanup(pool):
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM chug_scores WHERE discord_user_id = ANY($1::bigint[])", [_DISCORD_A, _DISCORD_B])


async def test_gather_facts_uses_only_real_numbers(pool):
    await _seed_owner(pool, "a", _DISCORD_A)
    await _seed_owner(pool, "b", _DISCORD_B)
    try:
        async with pool.acquire() as conn:
            for discord_id, seconds, grade in [(_DISCORD_A, 6.1, 6.2), (_DISCORD_B, 2.4, 9.1)]:
                await conn.execute(
                    "INSERT INTO chug_scores (discord_user_id, chug_time_seconds, smoothness_score, hype_score, "
                    "final_score, season, week, league_id) VALUES ($1, $2, 5, 5, $3, $4, 1, 1)",
                    discord_id, seconds, grade, TEST_SEASON,
                )
            this_chug = await conn.fetchval(
                "INSERT INTO chug_scores (discord_user_id, chug_time_seconds, smoothness_score, hype_score, "
                "final_score, season, week, league_id) VALUES ($1, 9.67, 5.6, 1.7, 4.69, $2, 3, 1) RETURNING id",
                _DISCORD_A, TEST_SEASON,
            )
            facts = await chug_roast.gather_facts(
                conn, chug_id=this_chug, owner_name="Roast a", discord_user_id=_DISCORD_A, season=TEST_SEASON,
                league_id=1, result=_RESULT, owed_before=2, owed_after=1, fined_owed=3, posted_by_commissioner=True,
            )
    finally:
        await _cleanup(pool)

    assert "Chugger: Roast a" in facts
    assert "Chug time: 9.67 seconds" in facts
    assert "Final grade: 4.69/10 (time 5.33/10, smoothness 5.6/10, hype 1.7/10)" in facts
    assert "owed 2 before, 1 still owed" in facts
    assert "$30 in unpaid chug fines" in facts
    assert "previous fastest 6.10s" in facts  # excludes this chug itself
    assert "Roast b, 2.40s" in facts
    assert "commissioner had to upload" in facts


async def test_write_roast_without_a_key_does_nothing(monkeypatch):
    called = []
    monkeypatch.setattr(chug_roast.config, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(chug_roast, "generate_narrative", lambda *a, **k: called.append(1) or "x")
    assert await chug_roast.write_roast("facts") is None
    assert called == []


async def test_write_roast_returns_the_model_text(monkeypatch):
    seen = {}

    def fake_generate(system_prompt, facts, max_tokens):
        seen.update(system=system_prompt, facts=facts, max_tokens=max_tokens)
        return "9.67 seconds? My grandma's IV drip is faster."

    monkeypatch.setattr(chug_roast.config, "ANTHROPIC_API_KEY", "fake-key-for-tests")
    monkeypatch.setattr(chug_roast, "generate_narrative", fake_generate)
    assert await chug_roast.write_roast("the facts") == "9.67 seconds? My grandma's IV drip is faster."
    assert seen["facts"] == "the facts"
    assert "ONLY the facts" in seen["system"]


async def test_write_roast_swallows_errors_and_timeouts(monkeypatch):
    monkeypatch.setattr(chug_roast.config, "ANTHROPIC_API_KEY", "fake-key-for-tests")

    def boom(*a, **k):
        raise RuntimeError("API down")

    monkeypatch.setattr(chug_roast, "generate_narrative", boom)
    assert await chug_roast.write_roast("facts") is None

    def slow(*a, **k):
        import time
        time.sleep(0.3)
        return "too late"

    monkeypatch.setattr(chug_roast, "generate_narrative", slow)
    monkeypatch.setattr(chug_roast, "ROAST_TIMEOUT_SECONDS", 0.05)
    assert await chug_roast.write_roast("facts") is None
    await asyncio.sleep(0.3)  # let the abandoned worker thread finish


async def test_upload_saves_and_returns_the_roast_and_feed_shows_it(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))

    async def fake_analysis(path):
        return dict(_RESULT)

    async def fake_roast(facts):
        assert "Chug time: 9.67 seconds" in facts
        return "Nine seconds. Bold of you to call that a chug."

    monkeypatch.setattr("app.routers.chug.run_chug_analysis", fake_analysis)
    monkeypatch.setattr("app.routers.chug.chug_storage.chug_storage_configured", lambda: False)
    monkeypatch.setattr("app.domain.chug_roast.write_roast", fake_roast)

    owner_id = await _seed_owner(pool, "upload", _DISCORD_A)
    user_id = await make_safe_session_user_id_for_owner(pool, owner_id)
    async with pool.acquire() as conn:
        await league_queries.add_member(conn, 1, user_id, "member")
    token = create_session_token(
        _SESSION_SECRET, user_id=user_id, owner_id=owner_id, discord_user_id=_DISCORD_A, is_commissioner=False,
    )
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            client.cookies.update({"session": token})
            body = (await client.post("/chug/upload", files={"video": ("c.mov", b"x", "video/quicktime")})).json()
            assert body["roast"] == "Nine seconds. Bold of you to call that a chug."
            feed = (await client.get("/chug/feed")).json()["chugs"]
        assert next(c for c in feed if c["id"] == body["id"])["roast"] == body["roast"]
    finally:
        await _cleanup(pool)
