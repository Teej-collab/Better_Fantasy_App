"""Tests for app/ai_usage.py — what each AI call costs, and Admin > AI Costs."""
import asyncio
from types import SimpleNamespace

from app import ai_usage
from app.providers import anthropic_narrative
from tests.test_admin import _commissioner_of_league_one_cookies, _get, _non_commissioner_cookies

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _response(input_tokens, output_tokens, text="Write-up."):
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)],
        stop_reason="end_turn",
        usage=SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens,
                              cache_read_input_tokens=0, cache_creation_input_tokens=0),
    )


def _drain():
    while not ai_usage._pending.empty():
        ai_usage._pending.get_nowait()


def test_sonnet_5_cost():
    # 1,300 in at $2/M and 500 out at $10/M.
    assert round(ai_usage.cost_usd("claude-sonnet-5", 1300, 500), 6) == 0.0076
    assert ai_usage.cost_usd("some-future-model", 1000, 1000) == 0.0


async def test_a_tagged_write_up_is_recorded_with_its_feature_league_and_cost(pool, monkeypatch):
    _drain()

    class FakeMessages:
        def create(self, **kwargs):
            return _response(1300, 500)

    monkeypatch.setattr(anthropic_narrative, "_get_client", lambda: SimpleNamespace(messages=FakeMessages()))
    # The tag rides into the worker thread, as it does for every write-up.
    with ai_usage.tagged("test-usage-matchup_recap", 1):
        text = await asyncio.to_thread(anthropic_narrative.generate_narrative, "system", "facts")
    assert text == "Write-up."

    async with pool.acquire() as conn:
        assert await ai_usage.flush(conn) == 1
        row = await conn.fetchrow(
            "SELECT * FROM ai_usage WHERE feature = 'test-usage-matchup_recap' ORDER BY id DESC LIMIT 1"
        )
        await conn.execute("DELETE FROM ai_usage WHERE feature LIKE 'test-usage%'")
    assert row["league_id"] == 1 and row["model"] == "claude-sonnet-5"
    assert (row["input_tokens"], row["output_tokens"]) == (1300, 500)
    assert float(row["cost_usd"]) == 0.0076


def test_tracking_never_breaks_the_call_it_measures():
    _drain()
    ai_usage.record(SimpleNamespace(), "claude-sonnet-5")  # no usage at all
    ai_usage.record(SimpleNamespace(usage=SimpleNamespace(input_tokens="oops")), "claude-sonnet-5")
    assert ai_usage._pending.empty()


async def test_admin_sees_cost_per_feature_and_league_and_others_cannot(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    _drain()
    with ai_usage.tagged("test-usage-weekly_recap", 1):
        ai_usage.record(_response(4500, 3500), "claude-sonnet-5")
    async with pool.acquire() as conn:
        await ai_usage.flush(conn)

    denied = await _get(cookies=await _non_commissioner_cookies(pool, "aiusage-denied"), path="/admin/ai-usage")
    assert denied.status_code == 403
    resp = await _get(cookies=await _commissioner_of_league_one_cookies(pool, "aiusage-admin"), path="/admin/ai-usage?days=7")
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM ai_usage WHERE feature LIKE 'test-usage%'")

    assert resp.status_code == 200
    body = resp.json()
    weekly = next(f for f in body["by_feature"] if f["feature"] == "test-usage-weekly_recap")
    assert weekly["calls"] == 1 and weekly["cost"] == 0.044  # 4,500 x $2/M + 3,500 x $10/M
    assert any(lg["league_id"] == 1 for lg in body["by_league"])
    assert body["per_league_per_week"] is not None
