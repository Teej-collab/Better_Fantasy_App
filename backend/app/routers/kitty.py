"""The league kitty and the offseason roster lock (2026-10-28) — see
app/domain/kitty.py and app/domain/offseason.py. Every member reads
both; only the commissioner changes them."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id, require_league_commissioner
from app.auth.session import decode_session_token, get_session_token
from app.config import _require
from app.db import get_pool
from app.domain import commish_log, kitty, offseason

router = APIRouter(prefix="/league", tags=["kitty"])


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
    payload = decode_session_token(SessionConfig().session_secret, token) if token else None
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


@router.get("/kitty")
async def get_kitty(request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        return await kitty.ledger(conn, league_id)


class KittyEntryBody(BaseModel):
    owner_id: int | None = None
    amount: float
    reason: str


@router.post("/kitty")
async def add_kitty_entry(body: KittyEntryBody, request: Request):
    payload = _require_session(request)
    reason = body.reason.strip()[:120]
    if not reason or body.amount <= 0 or body.amount > 100_000:
        raise HTTPException(status_code=400, detail="Give it a reason and an amount above $0")
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        if body.owner_id is not None and not await conn.fetchval(
            "SELECT 1 FROM teams_by_season WHERE owner_id = $1 AND league_id = $2", body.owner_id, league_id
        ):
            raise HTTPException(status_code=404, detail="That manager isn't in your league")
        await conn.execute(
            "INSERT INTO league_kitty_entries (league_id, season, owner_id, amount, reason) VALUES ($1, $2, $3, $4, $5)",
            league_id, season, body.owner_id, round(body.amount, 2), reason,
        )
        await commish_log.record(conn, league_id, payload["user_id"], "kitty", f"Kitty: added ${body.amount:g} for {reason}")
        return await kitty.ledger(conn, league_id)


class PaidBody(BaseModel):
    paid: bool


@router.post("/kitty/{entry_id}/paid")
async def mark_kitty_paid(entry_id: int, body: PaidBody, request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        row = await conn.fetchrow(
            "UPDATE league_kitty_entries SET paid_at = CASE WHEN $3 THEN COALESCE(paid_at, now()) ELSE NULL END "
            "WHERE id = $1 AND league_id = $2 RETURNING reason, amount",
            entry_id, league_id, body.paid,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="That entry isn't in your league's kitty")
        await commish_log.record(
            conn, league_id, payload["user_id"], "kitty",
            f"Kitty: {row['reason']} (${float(row['amount']):g}) marked {'paid' if body.paid else 'unpaid'}",
        )
        return await kitty.ledger(conn, league_id)


@router.delete("/kitty/{entry_id}")
async def delete_kitty_entry(entry_id: int, request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        row = await conn.fetchrow(
            "DELETE FROM league_kitty_entries WHERE id = $1 AND league_id = $2 RETURNING reason, amount", entry_id, league_id
        )
        if row is None:
            raise HTTPException(status_code=404, detail="That entry isn't in your league's kitty")
        await commish_log.record(conn, league_id, payload["user_id"], "kitty", f"Kitty: removed {row['reason']} (${float(row['amount']):g})")
        return await kitty.ledger(conn, league_id)


@router.get("/offseason")
async def get_offseason(request: Request):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        return await offseason.state(conn, season, league_id)


class OffseasonBody(BaseModel):
    lock: bool | None = None
    # True opens pickups for this season's offseason; False closes them again.
    cleared: bool | None = None


@router.put("/offseason")
async def set_offseason(body: OffseasonBody, request: Request):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        if body.lock is not None:
            await conn.execute("UPDATE leagues SET offseason_lock = $2 WHERE id = $1", league_id, body.lock)
            await commish_log.record(
                conn, league_id, payload["user_id"], "rules",
                f"Offseason pickups: {'blocked until the commissioner clears them' if body.lock else 'allowed'}",
            )
        if body.cleared is not None:
            await conn.execute(
                "UPDATE leagues SET offseason_cleared_season = $2 WHERE id = $1", league_id, season if body.cleared else None
            )
            await commish_log.record(
                conn, league_id, payload["user_id"], "rules",
                "Offseason cleared: free agency is open" if body.cleared else "Offseason pickups closed again",
            )
        return await offseason.state(conn, season, league_id)
