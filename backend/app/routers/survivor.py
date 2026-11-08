"""NFL survivor pools (2026-11-07) — see app/domain/survivor.py. A pool
belongs to a league (its commissioner creates it, its members join from
the hub) or stands alone (anyone with its code joins). Picks lock per
game, and other people's picks only show once that game starts."""
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth.config import SessionConfig
from app.auth.league_context import resolve_active_league_id
from app.auth.session import decode_session_token, get_session_token
from app.config import _require
from app.db import get_pool
from app.domain import survivor
from app.queries import leagues as league_queries

router = APIRouter(prefix="/survivor", tags=["survivor"])


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
    payload = decode_session_token(SessionConfig().session_secret, token) if token else None
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


def _season() -> int:
    return int(_require("ACTIVE_SEASON"))


async def _can_see(conn, pool: dict, user_id: int) -> bool:
    if pool["created_by"] == user_id:
        return True
    if await conn.fetchval("SELECT 1 FROM survivor_entries WHERE pool_id = $1 AND user_id = $2", pool["id"], user_id):
        return True
    return bool(pool["league_id"] and await league_queries.get_membership(conn, pool["league_id"], user_id))


async def _pool_for(conn, pool_id: int, user_id: int) -> dict:
    pool = await survivor.pool_row(conn, pool_id)
    if pool is None or not await _can_see(conn, pool, user_id):
        raise HTTPException(status_code=404, detail="That pool isn't one of yours")
    return pool


async def _entry_for(conn, entry_id: int, user_id: int) -> tuple[dict, dict]:
    row = await conn.fetchrow("SELECT * FROM survivor_entries WHERE id = $1 AND user_id = $2", entry_id, user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="That entry isn't yours")
    return dict(row), await survivor.pool_row(conn, row["pool_id"])


@router.get("/pools")
async def list_pools(request: Request):
    """The hub: every pool you're in or can join from your leagues, and
    whether your active league can have one made (by its commissioner)."""
    payload = _require_session(request)
    user_id = payload["user_id"]
    season = _season()
    week = await survivor.current_week(season)
    sched = await survivor.week_schedule(season, week)
    now = datetime.now(UTC)
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT p.id FROM survivor_pools p
            LEFT JOIN survivor_entries e ON e.pool_id = p.id AND e.user_id = $2
            LEFT JOIN league_members lm ON lm.league_id = p.league_id AND lm.user_id = $2
            WHERE p.season = $1 AND (e.id IS NOT NULL OR p.created_by = $2 OR lm.id IS NOT NULL)
            """,
            season, user_id,
        )
        pools = []
        for r in rows:
            p = await survivor.pool_row(conn, r["id"])
            entries = await survivor.entries_with_picks(conn, p["id"])
            pools.append(survivor.pool_summary(p, entries, user_id, week, sched, now))
        pools.sort(key=lambda p: (not p["mine"], not any(m["alive"] for m in p["mine"]), p["name"].lower()))
        active = await resolve_active_league_id(conn, payload)
        league = None
        if active:
            row = await conn.fetchrow(
                "SELECT l.id, l.name, lm.role FROM leagues l JOIN league_members lm ON lm.league_id = l.id AND lm.user_id = $2 WHERE l.id = $1",
                active, user_id,
            )
            if row:
                league = {"id": row["id"], "name": row["name"], "is_commissioner": row["role"] == "commissioner"}
    kickoffs = sorted(g["kickoff"] for g in sched.values() if g["kickoff"] and g["kickoff"] > now)
    return {
        "season": season, "week": week, "pools": pools, "league": league,
        "next_lock": kickoffs[0].isoformat() if kickoffs else None,
    }


class PoolBody(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    for_league: bool = False
    start_week: int | None = None
    lives: int = Field(default=1, ge=1, le=3)
    tie_counts_as: str = Field(default="loss", pattern="^(win|loss)$")
    buyback_until_week: int | None = Field(default=None, ge=1, le=18)
    double_from_week: int | None = Field(default=None, ge=1, le=18)
    missed_pick: str = Field(default="auto", pattern="^(auto|loss)$")
    max_entries: int = Field(default=1, ge=1, le=3)
    prize_note: str | None = Field(default=None, max_length=140)


@router.post("/pools")
async def create_pool(body: PoolBody, request: Request):
    payload = _require_session(request)
    user_id = payload["user_id"]
    season = _season()
    week = await survivor.current_week(season)
    sched = await survivor.week_schedule(season, week)
    now = datetime.now(UTC)
    # Starting this week only while its first game hasn't kicked off.
    earliest = week if not any(survivor.locked(g, now) for g in sched.values()) else week + 1
    start = body.start_week or earliest
    if start < earliest or start > survivor.LAST_WEEK:
        raise HTTPException(status_code=400, detail=f"Pick a start week from {earliest} to {survivor.LAST_WEEK}")
    if body.buyback_until_week is not None and body.buyback_until_week < start:
        raise HTTPException(status_code=400, detail="Buyback has to stay open until at least the start week")
    if body.double_from_week is not None and body.double_from_week <= start:
        raise HTTPException(status_code=400, detail="Two picks a week has to start after the first week")
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = None
        if body.for_league:
            league_id = await resolve_active_league_id(conn, payload)
            membership = league_id and await league_queries.get_membership(conn, league_id, user_id)
            if not membership or membership["role"] != "commissioner":
                raise HTTPException(status_code=403, detail="Only the league's commissioner can make its pool")
        async with conn.transaction():
            for _ in range(5):
                code = survivor.new_code()
                if not await conn.fetchval("SELECT 1 FROM survivor_pools WHERE join_code = $1", code):
                    break
            pool_id = await conn.fetchval(
                """
                INSERT INTO survivor_pools (season, name, league_id, created_by, join_code, start_week, lives, tie_counts_as,
                                            buyback_until_week, double_from_week, missed_pick, max_entries, prize_note)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id
                """,
                season, body.name.strip(), league_id, user_id, code, start, body.lives, body.tie_counts_as,
                body.buyback_until_week, body.double_from_week, body.missed_pick, body.max_entries,
                (body.prize_note or "").strip() or None,
            )
            await conn.execute("INSERT INTO survivor_entries (pool_id, user_id, entry_no) VALUES ($1, $2, 1)", pool_id, user_id)
    return {"id": pool_id, "join_code": code}


class JoinBody(BaseModel):
    code: str | None = None
    pool_id: int | None = None


@router.post("/join")
async def join_pool(body: JoinBody, request: Request):
    """Join by code, or by id for a pool in one of your leagues. Joining
    again adds another entry, up to the pool's max."""
    payload = _require_session(request)
    user_id = payload["user_id"]
    season = _season()
    pool = await get_pool()
    async with pool.acquire() as conn:
        if body.code:
            pool_id = await conn.fetchval("SELECT id FROM survivor_pools WHERE join_code = $1", body.code.strip().upper())
        else:
            pool_id = body.pool_id
        p = await survivor.pool_row(conn, pool_id) if pool_id else None
        if p is None or p["season"] != season:
            raise HTTPException(status_code=404, detail="No pool has that code")
        if p["league_id"] and not await league_queries.get_membership(conn, p["league_id"], user_id):
            raise HTTPException(status_code=403, detail=f"This pool is for {p['league_name'] or 'a league'}'s members")
        if not body.code and not p["league_id"]:
            raise HTTPException(status_code=403, detail="Join this pool with its code")
        week = await survivor.current_week(season)
        sched = await survivor.week_schedule(season, week)
        if not survivor.joinable(p, week, sched, datetime.now(UTC)):
            raise HTTPException(status_code=409, detail="This pool already started, so it's closed to new entries")
        async with conn.transaction():
            have = await conn.fetchval(
                "SELECT count(*) FROM survivor_entries WHERE pool_id = $1 AND user_id = $2", p["id"], user_id
            )
            if have >= p["max_entries"]:
                raise HTTPException(status_code=409, detail="You already have every entry this pool allows")
            entry_id = await conn.fetchval(
                "INSERT INTO survivor_entries (pool_id, user_id, entry_no) VALUES ($1, $2, $3) RETURNING id",
                p["id"], user_id, have + 1,
            )
    return {"pool_id": p["id"], "entry_id": entry_id}


@router.get("/pools/{pool_id}")
async def get_pool_detail(pool_id: int, request: Request):
    payload = _require_session(request)
    user_id = payload["user_id"]
    season = _season()
    week = await survivor.current_week(season)
    sched = await survivor.week_schedule(season, week)
    now = datetime.now(UTC)
    pool = await get_pool()
    async with pool.acquire() as conn:
        p = await _pool_for(conn, pool_id, user_id)
        entries = await survivor.entries_with_picks(conn, pool_id)
        return {
            **survivor.pool_summary(p, entries, user_id, week, sched, now),
            "field": survivor.field(p, entries, user_id, week, now),
            "is_commissioner": p["created_by"] == user_id,
        }


async def _entry_context(conn, entry_id: int, user_id: int):
    entry, p = await _entry_for(conn, entry_id, user_id)
    picks = [dict(r) for r in await conn.fetch("SELECT * FROM survivor_picks WHERE entry_id = $1", entry_id)]
    return entry, p, picks


@router.get("/entries/{entry_id}/board")
async def get_board(entry_id: int, request: Request, week: int | None = None):
    payload = _require_session(request)
    season = _season()
    current = await survivor.current_week(season)
    pool = await get_pool()
    async with pool.acquire() as conn:
        entry, p, picks = await _entry_context(conn, entry_id, payload["user_id"])
        shown = max(week or current, p["start_week"])
        return {
            **await survivor.board(conn, p, entry, picks, season, shown, datetime.now(UTC)),
            "pool": {"id": p["id"], "name": p["name"]}, "entry_no": entry["entry_no"], "can_pick": shown == current,
        }


class PicksBody(BaseModel):
    teams: list[str] = Field(max_length=2)


@router.put("/entries/{entry_id}/picks")
async def put_picks(entry_id: int, body: PicksBody, request: Request):
    payload = _require_session(request)
    season = _season()
    week = await survivor.current_week(season)
    now = datetime.now(UTC)
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            entry, p, _ = await _entry_context(conn, entry_id, payload["user_id"])
            try:
                await survivor.set_picks(conn, p, entry, season, week, body.teams, now)
            except survivor.PickError as error:
                raise HTTPException(status_code=409, detail=str(error)) from error
        entry, p, picks = await _entry_context(conn, entry_id, payload["user_id"])
        return {
            **await survivor.board(conn, p, entry, picks, season, week, now),
            "pool": {"id": p["id"], "name": p["name"]}, "entry_no": entry["entry_no"], "can_pick": True,
        }


@router.post("/entries/{entry_id}/best-pick")
async def best_pick(entry_id: int, request: Request):
    """The reminder's "Pick best odds" button (2026-11-08): fills this
    week's open slots the way the auto-pick would. Picks already made stay."""
    payload = _require_session(request)
    season = _season()
    week = await survivor.current_week(season)
    now = datetime.now(UTC)
    sched = await survivor.week_schedule(season, week)
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            entry, p, picks = await _entry_context(conn, entry_id, payload["user_id"])
            chances = await survivor.win_chances(conn, season, week, sched)
            new = survivor.best_picks(sched, chances, picks, week, survivor.slots(p, week), now)
            if not new:
                raise HTTPException(status_code=409, detail="Nothing left to pick this week")
            kept = [pk["team"] for pk in picks if pk["week"] == week and pk["team"]]
            try:
                await survivor.set_picks(conn, p, entry, season, week, kept + [t for _, t in new], now)
            except survivor.PickError as error:
                raise HTTPException(status_code=409, detail=str(error)) from error
    return {"teams": [t for _, t in new], "week": week, "pool_id": p["id"]}


@router.get("/entries/{entry_id}/planner")
async def get_planner(entry_id: int, request: Request):
    payload = _require_session(request)
    season = _season()
    week = await survivor.current_week(season)
    pool = await get_pool()
    async with pool.acquire() as conn:
        _, p, picks = await _entry_context(conn, entry_id, payload["user_id"])
        # This week's picks stay in the planner until their games lock.
        now = datetime.now(UTC)
        settled = [x for x in picks if x["week"] < week or x["result"] or (x["kickoff"] and x["kickoff"] <= now)]
        return await survivor.planner(conn, p, settled, season, week)


@router.post("/entries/{entry_id}/buyback")
async def post_buyback(entry_id: int, request: Request):
    payload = _require_session(request)
    season = _season()
    week = await survivor.current_week(season)
    pool = await get_pool()
    async with pool.acquire() as conn:
        entry, p, _ = await _entry_context(conn, entry_id, payload["user_id"])
        try:
            await survivor.buy_back(conn, p, entry, week)
        except survivor.PickError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
    return {"ok": True}


class PoolEditBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    prize_note: str | None = Field(default=None, max_length=140)


@router.patch("/pools/{pool_id}")
async def edit_pool(pool_id: int, body: PoolEditBody, request: Request):
    """The creator renames the pool or changes the prize note. The rules
    stay as everyone joined under."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        p = await _pool_for(conn, pool_id, payload["user_id"])
        if p["created_by"] != payload["user_id"]:
            raise HTTPException(status_code=403, detail="Only the pool's creator can change it")
        await conn.execute(
            "UPDATE survivor_pools SET name = COALESCE($2, name), prize_note = CASE WHEN $3::text IS NULL THEN prize_note ELSE NULLIF($3, '') END WHERE id = $1",
            pool_id, body.name.strip() if body.name else None, body.prize_note.strip() if body.prize_note is not None else None,
        )
    return {"ok": True}


@router.delete("/entries/{entry_id}")
async def remove_entry(entry_id: int, request: Request):
    """The pool's creator removes an entry (or you remove your own) before
    it has made a pick that locked."""
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT e.*, p.created_by FROM survivor_entries e JOIN survivor_pools p ON p.id = e.pool_id WHERE e.id = $1", entry_id
        )
        if row is None or payload["user_id"] not in (row["user_id"], row["created_by"]):
            raise HTTPException(status_code=404, detail="That entry isn't yours to remove")
        if await conn.fetchval(
            "SELECT 1 FROM survivor_picks WHERE entry_id = $1 AND (result IS NOT NULL OR kickoff <= now())", entry_id
        ):
            raise HTTPException(status_code=409, detail="This entry already has a locked pick")
        await conn.execute("DELETE FROM survivor_entries WHERE id = $1", entry_id)
    return {"ok": True}
