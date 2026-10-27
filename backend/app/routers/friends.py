"""
Friends (2026-10-26): find people by username or from the leagues you've
played in, send and accept requests, and invite friends to a Lounge room
(app/routers/lounge.py) even when they aren't in your league.

Friends are between accounts, not league owners, so nothing here touches
a league: no league tables are written and no league screen changes.
Blocking someone in chat (owner_blocks) hides you from each other here
too.
"""
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth.config import SessionConfig
from app.auth.session import decode_session_token, get_session_token
from app.db import get_pool
from app.notifications import dispatcher, formatter
from app.queries import friends as friend_queries

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/friends", tags=["friends"])

USERNAME = re.compile(r"^[a-z0-9_.]{3,20}$")


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
    payload = decode_session_token(SessionConfig().session_secret, token) if token else None
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


def _person(row, **extra) -> dict:
    return {
        "user_id": row["user_id"],
        "name": row["name"],
        "username": row["username"],
        "photo_url": row["photo_url"],
        **extra,
    }


async def _push(conn, user_id: int, payload: dict) -> None:
    """Pushes go to the account's owner record (that's where devices
    register). An account with no league yet has none, so it just sees
    the request next time it opens Friends."""
    try:
        owner_id = await friend_queries.owner_id_for_user(conn, user_id)
        if owner_id is not None:
            await dispatcher.send_to_owner(conn, owner_id, payload)
    except Exception:
        logger.exception("Friend push failed (user %s)", user_id)


class UsernameBody(BaseModel):
    username: str = Field(max_length=40)


class RequestBody(BaseModel):
    user_id: int


@router.get("/me")
async def get_me(request: Request, pool=Depends(get_pool)):
    user_id = _require_session(request)["user_id"]
    async with pool.acquire() as conn:
        return {"username": await friend_queries.get_username(conn, user_id)}


@router.put("/me/username")
async def set_username(body: UsernameBody, request: Request, pool=Depends(get_pool)):
    user_id = _require_session(request)["user_id"]
    username = body.username.strip().lstrip("@").lower()
    if not USERNAME.match(username):
        raise HTTPException(
            status_code=400, detail="3–20 characters: letters, numbers, underscores and periods."
        )
    async with pool.acquire() as conn:
        if not await friend_queries.set_username(conn, user_id, username):
            raise HTTPException(status_code=409, detail=f"@{username} is taken.")
    return {"username": username}


@router.get("")
async def list_friends(request: Request, pool=Depends(get_pool)):
    user_id = _require_session(request)["user_id"]
    async with pool.acquire() as conn:
        rows = await friend_queries.list_all(conn, user_id)
    friends, incoming, outgoing = [], [], []
    for r in rows:
        p = _person(r, shared_leagues=list(r["shared_leagues"]))
        if r["accepted"]:
            friends.append(p)
        elif r["i_asked"]:
            outgoing.append(p)
        else:
            incoming.append(p)
    return {"friends": friends, "incoming": incoming, "outgoing": outgoing}


@router.get("/search")
async def search(q: str, request: Request, pool=Depends(get_pool)):
    user_id = _require_session(request)["user_id"]
    q = q.strip().lstrip("@")
    if len(q) < 2:
        return {"results": []}
    async with pool.acquire() as conn:
        rows = await friend_queries.search(conn, user_id, q)
        return {
            "results": [
                _person(r, relationship=await friend_queries.relationship(conn, user_id, r["user_id"])) for r in rows
            ]
        }


@router.get("/played-with")
async def played_with(request: Request, pool=Depends(get_pool)):
    user_id = _require_session(request)["user_id"]
    async with pool.acquire() as conn:
        rows = await friend_queries.played_with(conn, user_id)
    return {"people": [_person(r, shared_leagues=list(r["shared_leagues"])) for r in rows]}


@router.post("/requests")
async def send_request(body: RequestBody, request: Request, pool=Depends(get_pool)):
    """Asks someone to be friends. If they'd already asked you, this
    accepts theirs instead."""
    user_id = _require_session(request)["user_id"]
    other_id = body.user_id
    if other_id == user_id:
        raise HTTPException(status_code=400, detail="That's you.")
    async with pool.acquire() as conn:
        if not await friend_queries.user_exists(conn, other_id) or await friend_queries.is_blocked(conn, user_id, other_id):
            raise HTTPException(status_code=404, detail="Couldn't find that person.")
        current = await friend_queries.relationship(conn, user_id, other_id)
        if current in ("friends", "outgoing"):
            return {"relationship": current}
        me = await friend_queries.person(conn, user_id)
        if current == "incoming":
            await friend_queries.accept(conn, user_id, other_id)
            await _push(conn, other_id, formatter.friend_accepted(me["name"], user_id))
            return {"relationship": "friends"}
        await friend_queries.request(conn, user_id, other_id)
        await _push(conn, other_id, formatter.friend_request(me["name"], user_id))
    return {"relationship": "outgoing"}


@router.post("/requests/{other_id}/accept")
async def accept_request(other_id: int, request: Request, pool=Depends(get_pool)):
    user_id = _require_session(request)["user_id"]
    async with pool.acquire() as conn:
        if not await friend_queries.accept(conn, user_id, other_id):
            raise HTTPException(status_code=404, detail="That request isn't there anymore.")
        me = await friend_queries.person(conn, user_id)
        await _push(conn, other_id, formatter.friend_accepted(me["name"], user_id))
    return {"relationship": "friends"}


@router.delete("/{other_id}")
async def remove(other_id: int, request: Request, pool=Depends(get_pool)):
    """Unfriend, decline their request or cancel yours."""
    user_id = _require_session(request)["user_id"]
    async with pool.acquire() as conn:
        await friend_queries.remove(conn, user_id, other_id)
    return {"relationship": "none"}
