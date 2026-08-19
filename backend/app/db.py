"""
Postgres connection layer. Everything else in the backend reads through here.

Points at the same Supabase project Fantasy_Helper already writes to
(per Phase 1 decision: shared DB, backend is read-only until schema changes
are explicitly approved). Do not add write queries here without checking
that decision still holds.
"""
import asyncpg
from app import config

_pool = None


async def get_pool():
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(config.DATABASE_URL)
    return _pool
