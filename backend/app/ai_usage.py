"""
What each AI call costs (2026-10-28): every write-up, roast, hype grade
and bet slip read records its tokens and dollar cost in ai_usage, tagged
with the feature and league, so Admin > AI Costs can show the real cost
per league instead of an estimate.

Callers tag their work with `tagged(feature, league_id)` around the
awaited `asyncio.to_thread(...)` call; the tag rides into that thread
(to_thread copies context variables), and `record(response)`, called
right after every `messages.create`, queues the response's usage with it.
A background task writes the queue every FLUSH_SECONDS, so recording
never slows a write-up down; a crash can lose at most that much.
"""
import asyncio
import contextlib
import contextvars
import logging
import queue

logger = logging.getLogger(__name__)

FLUSH_SECONDS = 30

# Per million tokens: (input, output, cache read, cache write).
# https://platform.claude.com/docs/en/about-claude/pricing
PRICES = {
    "claude-sonnet-5": (2.00, 10.00, 0.20, 2.50),
    "claude-sonnet-5-5": (2.00, 10.00, 0.20, 2.50),
    "claude-opus-5-5": (4.00, 20.00, 0.40, 5.00),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125),
}

_tag: contextvars.ContextVar[tuple[str, int | None] | None] = contextvars.ContextVar("ai_usage_tag", default=None)
_pending: "queue.SimpleQueue[dict]" = queue.SimpleQueue()


@contextlib.contextmanager
def tagged(feature: str, league_id: int | None = None):
    token = _tag.set((feature, league_id))
    try:
        yield
    finally:
        _tag.reset(token)


def cost_usd(model: str, input_tokens: int, output_tokens: int, cache_read: int = 0, cache_write: int = 0) -> float:
    rates = PRICES.get(model)
    if rates is None:
        return 0.0
    i, o, cr, cw = rates
    return (input_tokens * i + output_tokens * o + cache_read * cr + cache_write * cw) / 1_000_000


def record(response, model: str, default_feature: str = "untagged") -> None:
    """Queue one response's usage. Never raises: tracking must not break
    the feature it's measuring."""
    try:
        usage = getattr(response, "usage", None)
        if usage is None:
            return
        feature, league_id = _tag.get() or (default_feature, None)
        input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
        output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
        cache_read = int(getattr(usage, "cache_read_input_tokens", 0) or 0)
        cache_write = int(getattr(usage, "cache_creation_input_tokens", 0) or 0)
        _pending.put({
            "feature": feature,
            "league_id": league_id,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_read_tokens": cache_read,
            "cache_write_tokens": cache_write,
            "cost_usd": cost_usd(model, input_tokens, output_tokens, cache_read, cache_write),
            "stop_reason": getattr(response, "stop_reason", None),
        })
    except Exception:
        logger.exception("Couldn't record AI usage")


async def flush(conn) -> int:
    rows = []
    while True:
        try:
            rows.append(_pending.get_nowait())
        except queue.Empty:
            break
    if not rows:
        return 0
    await conn.executemany(
        """
        INSERT INTO ai_usage (feature, league_id, model, input_tokens, output_tokens,
                              cache_read_tokens, cache_write_tokens, cost_usd, stop_reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        """,
        [
            (r["feature"], r["league_id"], r["model"], r["input_tokens"], r["output_tokens"],
             r["cache_read_tokens"], r["cache_write_tokens"], r["cost_usd"], r["stop_reason"])
            for r in rows
        ],
    )
    return len(rows)


async def flush_forever(get_pool) -> None:
    """The background writer, started with the app."""
    while True:
        await asyncio.sleep(FLUSH_SECONDS)
        try:
            pool = await get_pool()
            async with pool.acquire() as conn:
                await flush(conn)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Couldn't write AI usage")


async def report(conn, days: int) -> dict:
    """Admin > AI Costs: spend over the last `days`, by feature and by
    league, and what that comes to per league per week."""
    by_feature = await conn.fetch(
        """
        SELECT feature, count(*) AS calls, sum(input_tokens) AS input_tokens,
               sum(output_tokens) AS output_tokens, sum(cost_usd) AS cost
        FROM ai_usage WHERE created_at > now() - make_interval(days => $1)
        GROUP BY feature ORDER BY cost DESC
        """,
        days,
    )
    by_league = await conn.fetch(
        """
        SELECT u.league_id, l.name, count(*) AS calls, sum(u.cost_usd) AS cost
        FROM ai_usage u LEFT JOIN leagues l ON l.id = u.league_id
        WHERE u.created_at > now() - make_interval(days => $1)
        GROUP BY u.league_id, l.name ORDER BY cost DESC
        """,
        days,
    )
    total = sum(float(r["cost"] or 0) for r in by_feature)
    league_costs = [float(r["cost"] or 0) for r in by_league if r["league_id"] is not None]
    per_league_week = (sum(league_costs) / len(league_costs)) * 7 / days if league_costs else None
    first = await conn.fetchval("SELECT min(created_at) FROM ai_usage")
    return {
        "days": days,
        "since": first.isoformat() if first else None,
        "total_cost": round(total, 4),
        "calls": sum(r["calls"] for r in by_feature),
        "per_league_per_week": round(per_league_week, 4) if per_league_week is not None else None,
        "by_feature": [
            {"feature": r["feature"], "calls": r["calls"], "input_tokens": int(r["input_tokens"] or 0),
             "output_tokens": int(r["output_tokens"] or 0), "cost": round(float(r["cost"] or 0), 4)}
            for r in by_feature
        ],
        "by_league": [
            {"league_id": r["league_id"], "name": r["name"] or ("Not tied to a league" if r["league_id"] is None else f"League {r['league_id']}"),
             "calls": r["calls"], "cost": round(float(r["cost"] or 0), 4)}
            for r in by_league
        ],
    }
