"""League Manager Polls (2026-09-03 plan) — the commissioner asks a
question with a fixed set of options, members vote, results are live.
See migration c31d8f5a92e7 for the schema and app/queries/polls.py for
the plain CRUD/tally SQL this is a thin HTTP wrapper around.

Create/close are commissioner-only; list/vote are open to any real
member of THIS specific league (require_member_of, checked against the
path's own league_id — never require_active_league_id, which only
confirms the caller has *some* active league and would let a member of
league A read/vote on league B's polls just by editing the URL) — a
poll only matters if the people it's asking can actually see and
answer it.
"""
import json

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_commissioner_of, require_member_of
from app.auth.session import decode_session_token, get_session_token
from app.db import get_pool
from app.queries import polls as poll_queries

router = APIRouter(prefix="/leagues", tags=["polls"])


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return payload


def _poll_dict(row: dict, vote_counts: dict[int, int], my_vote: int | None) -> dict:
    options = json.loads(row["options"]) if isinstance(row["options"], str) else row["options"]
    return {
        "id": row["id"],
        "question": row["question"],
        "options": options,
        "status": row["status"],
        "created_at": row["created_at"].isoformat(),
        "closed_at": row["closed_at"].isoformat() if row["closed_at"] else None,
        "results": [vote_counts.get(i, 0) for i in range(len(options))],
        "my_vote": my_vote,
    }


class CreatePollRequest(BaseModel):
    question: str
    options: list[str]


@router.post("/{league_id}/polls")
async def create_poll(league_id: int, body: CreatePollRequest, request: Request):
    question = body.question.strip()
    options = [o.strip() for o in body.options if o.strip()]
    if not question:
        raise HTTPException(status_code=400, detail="Enter a question")
    if len(options) < 2:
        raise HTTPException(status_code=400, detail="Enter at least two options")

    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, league_id)
        row = await poll_queries.create_poll(conn, league_id, question, options, payload["user_id"])
    return _poll_dict(row, {}, None)


@router.get("/{league_id}/polls")
async def list_polls(league_id: int, request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_member_of(conn, payload, league_id)
        rows = await poll_queries.list_polls(conn, league_id)
        poll_ids = [r["id"] for r in rows]
        counts_by_poll = await poll_queries.get_vote_counts_for_polls(conn, poll_ids)
        my_votes = await poll_queries.get_my_votes(conn, poll_ids, payload["user_id"])
    return {
        "polls": [_poll_dict(row, counts_by_poll.get(row["id"], {}), my_votes.get(row["id"])) for row in rows]
    }


class VoteRequest(BaseModel):
    option_index: int


@router.post("/{league_id}/polls/{poll_id}/vote")
async def vote_on_poll(league_id: int, poll_id: int, body: VoteRequest, request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_member_of(conn, payload, league_id)
        poll = await poll_queries.get_poll(conn, league_id, poll_id)
        if poll is None:
            raise HTTPException(status_code=404, detail="Poll not found")
        options = json.loads(poll["options"]) if isinstance(poll["options"], str) else poll["options"]
        if poll["status"] != "open":
            raise HTTPException(status_code=409, detail="This poll is closed")
        if not (0 <= body.option_index < len(options)):
            raise HTTPException(status_code=400, detail="Invalid option")

        await poll_queries.cast_vote(conn, poll_id, payload["user_id"], body.option_index)
        vote_counts = await poll_queries.get_vote_counts(conn, poll_id)
    return _poll_dict(poll, vote_counts, body.option_index)


@router.patch("/{league_id}/polls/{poll_id}")
async def close_poll(league_id: int, poll_id: int, request: Request):
    payload = _require_session(request)
    pool = await get_pool()
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, league_id)
        row = await poll_queries.close_poll(conn, league_id, poll_id)
        if row is None:
            raise HTTPException(status_code=404, detail="No open poll found for that id")
        vote_counts = await poll_queries.get_vote_counts(conn, poll_id)
        my_vote = (await poll_queries.get_my_votes(conn, [poll_id], payload["user_id"])).get(poll_id)
    return _poll_dict(row, vote_counts, my_vote)
