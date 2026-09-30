"""
Postgres connection layer. Everything else in the backend reads through here.

Points at the same Supabase project Fantasy_Helper already writes to.
DATABASE_URL should be Supabase's connection *pooler* string, not the
direct db.<ref>.supabase.co host — that host is IPv6-only and won't
resolve on IPv4-only networks. statement_cache_size=0 is required because
Supabase's transaction-mode pooler (pgbouncer) doesn't support asyncpg's
prepared statements — see https://github.com/MagicStack/asyncpg/issues
for the underlying issue if this ever needs revisiting.
"""
import asyncpg
from app import config

_pool = None


async def get_pool():
    global _pool
    if _pool is None:
        # max_size: endpoints like /matchup-context fan independent reads
        # out across several pooled connections at once (asyncio.gather),
        # and the home page fires ~12 of those requests together. The old
        # default cap of 10 made them queue for connections, and a
        # request holding one while waiting for more could stall.
        # Supabase's transaction-mode pooler is built for many client
        # connections, so 40 is well within its limit. min_size=10 keeps
        # enough warm for one fanned-out request without reconnecting.
        _pool = await asyncpg.create_pool(config.DATABASE_URL, statement_cache_size=0, min_size=10, max_size=40)
    return _pool


async def on_own_conn(fn, *args, **kwargs):
    """Runs one read on its own pooled connection, so independent reads
    can go out together via asyncio.gather instead of queuing on one
    connection. Every query costs a full round trip to Supabase's
    pooler (~50 ms), so a dozen sequential reads alone add up to most
    of a second."""
    pool = await get_pool()
    async with pool.acquire() as c:
        return await fn(c, *args, **kwargs)
