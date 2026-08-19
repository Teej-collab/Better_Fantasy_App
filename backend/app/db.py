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
        _pool = await asyncpg.create_pool(config.DATABASE_URL, statement_cache_size=0)
    return _pool
