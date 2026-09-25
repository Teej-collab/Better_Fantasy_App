"""
Single-use redemption tracking for the native OAuth completion ticket
— see migration 4b0f790da9c8 for why this only ever records REDEEMED
tickets, not issued ones.
"""
import asyncpg


async def redeem_once(conn, jti: str) -> bool:
    """Returns True the first time this jti is redeemed (and records
    it), False if it was already redeemed. Relies on jti being the
    table's PRIMARY KEY for atomicity — the INSERT itself is the
    check, not a SELECT-then-INSERT that could race under concurrent
    redemption attempts of the same ticket."""
    try:
        await conn.execute("INSERT INTO used_oauth_tickets (jti) VALUES ($1)", jti)
        return True
    except asyncpg.UniqueViolationError:
        return False
