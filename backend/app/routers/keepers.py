"""Keeper-league tracking — owners pick their keepers for the active
season from their prior season's own roster; the commissioner
configures how many keepers are allowed, any cap on consecutive years
the same player can be kept, and the selection deadline, then locks the
window once it's final.

Owner-facing routes resolve owner_id from the session only, same
"no owner_id from the caller" discipline as app/routers/settings.py.
Commissioner routes reuse the is_commissioner session flag the same
way app/routers/chug.py's clear-fine endpoint does.

ESPN write-back (pushing locked selections into ESPN's own copy of the
league) is intentionally NOT implemented here yet — see the project
plan's Part A: it needs a first-time reverse-engineering spike (a
commissioner designating a keeper in ESPN's own UI while the real
request is captured) before we know it's even possible, the same way
app/providers/espn/lineup_client.py's working write was originally
captured. This router is fully functional as an in-app system of
record regardless of whether that spike ever succeeds.
"""
import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import _require
from app.db import get_pool
from app.queries import keepers as keeper_queries

router = APIRouter(prefix="/keepers", tags=["keepers"])


def _decode_session(token: str | None) -> dict | None:
    if not token:
        return None
    config = SessionConfig()
    return decode_session_token(config.session_secret, token)


def _require_session(request: Request) -> dict:
    payload = _decode_session(request.cookies.get(SESSION_COOKIE_NAME))
    if payload is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return payload


def _require_commissioner(request: Request) -> dict:
    payload = _require_session(request)
    if not payload.get("is_commissioner"):
        raise HTTPException(status_code=403, detail="Commissioner only")
    return payload


def _rules_dict(row, season: int) -> dict:
    """A season with no configured rules yet reads as "keepers not open"
    rather than 404/error — the frontend can show a plain "not open yet"
    state instead of needing to special-case a missing row."""
    if row is None:
        return {
            "season": season,
            "max_keepers": 0,
            "max_consecutive_years": None,
            "keeper_deadline": None,
            "locked_at": None,
            "is_open": False,
        }
    now = datetime.datetime.now(datetime.timezone.utc)
    is_open = row["locked_at"] is None and (row["keeper_deadline"] is None or now < row["keeper_deadline"])
    return {
        "season": row["season"],
        "max_keepers": row["max_keepers"],
        "max_consecutive_years": row["max_consecutive_years"],
        "keeper_deadline": row["keeper_deadline"].isoformat() if row["keeper_deadline"] else None,
        "locked_at": row["locked_at"].isoformat() if row["locked_at"] else None,
        "is_open": is_open,
    }


@router.get("/me")
async def get_my_keepers(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    owner_id = payload["owner_id"]
    active_season = int(_require("ACTIVE_SEASON"))
    prior_season = active_season - 1

    async with pool.acquire() as conn:
        rules_row = await keeper_queries.get_rules(conn, active_season)
        pool_rows = await keeper_queries.get_owner_roster_pool(conn, owner_id, prior_season)
        current = await keeper_queries.get_selections(conn, active_season, owner_id)
        prior = await keeper_queries.get_prior_season_selections(conn, owner_id, prior_season)

    rules = _rules_dict(rules_row, active_season)
    prior_by_player = {r["espn_player_id"]: r for r in prior}

    return {
        "rules": rules,
        "roster_pool": [
            {
                "espn_player_id": r["espn_player_id"],
                "player_name": r["player_name"],
                "position": r["position"],
                "pro_team": r["pro_team"],
                # A player already kept last season is only still
                # eligible if the cap (if any) hasn't been hit — the
                # frontend uses this to grey out an ineligible player
                # rather than letting them get picked and rejected.
                "eligible": (
                    rules["max_consecutive_years"] is None
                    or r["espn_player_id"] not in prior_by_player
                    or prior_by_player[r["espn_player_id"]]["consecutive_years_kept"] < rules["max_consecutive_years"]
                ),
                "consecutive_years_if_kept": prior_by_player[r["espn_player_id"]]["consecutive_years_kept"] + 1
                if r["espn_player_id"] in prior_by_player
                else 1,
            }
            for r in pool_rows
        ],
        "selections": [dict(r) | {"created_at": r["created_at"].isoformat()} for r in current],
    }


class KeeperSelectionsBody(BaseModel):
    espn_player_ids: list[int]


@router.put("/me")
async def update_my_keepers(body: KeeperSelectionsBody, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    owner_id = payload["owner_id"]
    active_season = int(_require("ACTIVE_SEASON"))
    prior_season = active_season - 1

    ids = body.espn_player_ids
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=400, detail="Duplicate players in selection")

    async with pool.acquire() as conn:
        rules_row = await keeper_queries.get_rules(conn, active_season)
        rules = _rules_dict(rules_row, active_season)
        if not rules["is_open"]:
            raise HTTPException(status_code=409, detail="Keeper selection isn't open for this season")
        if len(ids) > rules["max_keepers"]:
            raise HTTPException(status_code=400, detail=f"You can keep at most {rules['max_keepers']} player(s)")

        pool_rows = await keeper_queries.get_owner_roster_pool(conn, owner_id, prior_season)
        pool_by_id = {r["espn_player_id"]: r for r in pool_rows}
        prior = await keeper_queries.get_prior_season_selections(conn, owner_id, prior_season)
        prior_by_id = {r["espn_player_id"]: r for r in prior}

        players = []
        for pid in ids:
            if pid not in pool_by_id:
                raise HTTPException(status_code=400, detail=f"Player {pid} isn't on your roster")
            consecutive = prior_by_id[pid]["consecutive_years_kept"] + 1 if pid in prior_by_id else 1
            if rules["max_consecutive_years"] is not None and consecutive > rules["max_consecutive_years"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"{pool_by_id[pid]['player_name']} has already been kept the maximum number of years",
                )
            players.append(
                {
                    "espn_player_id": pid,
                    "player_name": pool_by_id[pid]["player_name"],
                    "consecutive_years_kept": consecutive,
                }
            )

        updated = await keeper_queries.replace_selections(conn, active_season, owner_id, players)

    return {"selections": [dict(r) | {"created_at": r["created_at"].isoformat()} for r in updated]}


class KeeperRulesBody(BaseModel):
    season: int
    max_keepers: int
    max_consecutive_years: int | None = None
    keeper_deadline: datetime.datetime | None = None


@router.put("/rules")
async def set_keeper_rules(body: KeeperRulesBody, request: Request, pool=Depends(get_pool)):
    _require_commissioner(request)
    if body.max_keepers < 0:
        raise HTTPException(status_code=400, detail="max_keepers can't be negative")
    if body.max_consecutive_years is not None and body.max_consecutive_years < 1:
        raise HTTPException(status_code=400, detail="max_consecutive_years must be at least 1")

    async with pool.acquire() as conn:
        row = await keeper_queries.upsert_rules(
            conn, body.season, body.max_keepers, body.max_consecutive_years, body.keeper_deadline
        )
    if row is None:
        raise HTTPException(status_code=409, detail="Rules are locked for this season — unlock first to change them")
    return _rules_dict(row, body.season)


class SeasonBody(BaseModel):
    season: int


@router.post("/rules/lock")
async def lock_keeper_rules(body: SeasonBody, request: Request, pool=Depends(get_pool)):
    _require_commissioner(request)
    async with pool.acquire() as conn:
        row = await keeper_queries.lock_rules(conn, body.season)
        if row is None:
            row = await keeper_queries.get_rules(conn, body.season)
    return _rules_dict(row, body.season)


@router.post("/rules/unlock")
async def unlock_keeper_rules(body: SeasonBody, request: Request, pool=Depends(get_pool)):
    _require_commissioner(request)
    async with pool.acquire() as conn:
        row = await keeper_queries.unlock_rules(conn, body.season)
    if row is None:
        raise HTTPException(status_code=404, detail=f"No keeper rules configured for {body.season}")
    return _rules_dict(row, body.season)
