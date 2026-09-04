"""Keeper-league tracking — owners pick their keepers for the active
season from their real, current in-app roster, the commissioner
configures how many keepers are allowed, any cap on consecutive years
the same player can be kept, and the selection deadline, then locks
the window once it's final.

Owner-facing routes resolve owner_id from the session only, same
"no owner_id from the caller" discipline as app/routers/settings.py.
Commissioner routes use a live per-league check (app/auth/
league_context.py) instead of the old global is_commissioner session
flag — see TODO.md's PHASE 9 entry. Every route also resolves
league_id from the session, never a client-supplied value.

ROSTER POOL SOURCE — current_rosters, this app's own in-app draft/
lineup system of record (app/domain/lineup_engine.py's My Team reads
from the exact same table), NOT a live ESPN read. This used to hit
ESPNLineupClient.get_roster(espn_team_id, active_season) directly (see
git history on this docstring for the original reasoning, from before
this app had its own in-app draft) — a real production bug (2026-09-04:
"a user's keeper roster isn't showing"), since that live-ESPN read
silently returns an empty roster for two real, common cases: (1) any
team created through the self-serve "create your team" flow has a
SYNTHETIC espn_team_id (see app/queries/teams.py's create_team —
`nextval('synthetic_espn_team_id_seq')`, not a real ESPN team), which
ESPN's API naturally has nothing to return for; (2) even a team with a
real espn_team_id has a roster that's since diverged from ESPN's own
copy, because real roster moves (the in-app draft, free agents, lineup
swaps) happen entirely in this app now, not on ESPN. Both cases are the
normal case for this league today, not an edge case — current_rosters
is the only roster source that's actually still correct.

keeper_selections carries a player's identity forward year over year as
espn_player_id (not sleeper_player_id), so the pool below still reports
espn_player_id per row — resolved via players.espn_player_id, the same
crosswalk app/domain/draft_engine.py's seed_keepers_from_locked_selections
already uses to turn a locked keeper into a real draft pick. A player on
the roster with no espn_player_id (the crosswalk doesn't cover 100% of
players — see app/providers/sleeper/ingest.py) can't be offered as a
keeper under this identity scheme and is left out of the pool, same as
that other resolution path's own KeeperResolutionError case.

ESPN write-back (pushing locked selections into ESPN's own copy of the
league) is intentionally NOT implemented here — this league's real
draft/rosters are no longer ESPN's to begin with, so there's nothing on
ESPN's side left to write back to. This router is fully functional as
an in-app system of record on its own.
"""
import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id, require_league_commissioner
from app.auth.session import SESSION_COOKIE_NAME, decode_session_token
from app.config import _require
from app.db import get_pool
from app.queries import draft as draft_queries
from app.queries import keepers as keeper_queries

router = APIRouter(prefix="/keepers", tags=["keepers"])


async def _get_roster_pool(conn, owner_id: int, active_season: int, league_id: int) -> list[dict]:
    """The players an owner can choose a keeper from — their real,
    current in-app roster (see module docstring). A JOIN, not a
    separate "does this owner have a team" check first — naturally
    returns an empty list (not an error) for an owner with no team,
    or no draft/roster yet, this season."""
    rows = await conn.fetch(
        """
        SELECT p.espn_player_id, p.full_name AS player_name, p.position, p.pro_team
        FROM teams_by_season t
        JOIN current_rosters cr ON cr.team_id = t.id AND cr.season = t.season
        JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
        WHERE t.season = $1 AND t.owner_id = $2 AND t.league_id = $3
          AND p.espn_player_id IS NOT NULL
        ORDER BY p.full_name
        """,
        active_season, owner_id, league_id,
    )
    return [dict(r) for r in rows]


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


def _rules_dict(row, season: int, draft_scheduled_start=None) -> dict:
    """A season with no configured rules yet reads as "keepers not open"
    rather than 404/error — the frontend can show a plain "not open yet"
    state instead of needing to special-case a missing row.

    draft_scheduled_start (draft_config.scheduled_start — the same time
    DraftCountdownCard.tsx counts down to) is only ever passed at the
    GET /me call site, where the owner-facing panel needs it to show a
    live "locks automatically in..." countdown once the keeper auto-lock
    scheduler job (app/scheduler.py's _run_keeper_lock_job) is about to
    fire — the PUT rules/lock/unlock call sites below don't pass it,
    since those responses aren't what drives that countdown display."""
    if row is None:
        return {
            "season": season,
            "max_keepers": 0,
            "max_consecutive_years": None,
            "keeper_deadline": None,
            "locked_at": None,
            "is_open": False,
            "draft_scheduled_start": draft_scheduled_start.isoformat() if draft_scheduled_start else None,
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
        "draft_scheduled_start": draft_scheduled_start.isoformat() if draft_scheduled_start else None,
    }


@router.get("/me")
async def get_my_keepers(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    owner_id = payload["owner_id"]
    active_season = int(_require("ACTIVE_SEASON"))
    prior_season = active_season - 1

    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        pool_rows = await _get_roster_pool(conn, owner_id, active_season, league_id)
        rules_row = await keeper_queries.get_rules(conn, active_season, league_id)
        current = await keeper_queries.get_selections(conn, active_season, owner_id, league_id)
        prior = await keeper_queries.get_prior_season_selections(conn, owner_id, prior_season, league_id)
        # Whichever of draft_config/league_draft_schedule currently
        # holds the real draft time — a commissioner may have set just
        # the date before deciding the draft order (see that table's
        # own migration docstring), and the keeper auto-lock countdown
        # should still work in that case, same as the homepage's own
        # Draft Countdown card (your_week.py).
        draft_scheduled_start = await draft_queries.get_effective_scheduled_start(conn, active_season, league_id)

    rules = _rules_dict(rules_row, active_season, draft_scheduled_start)
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
        league_id = await require_active_league_id(conn, payload)
        rules_row = await keeper_queries.get_rules(conn, active_season, league_id)
        rules = _rules_dict(rules_row, active_season)
        if not rules["is_open"]:
            raise HTTPException(status_code=409, detail="Keeper selection isn't open for this season")
        if len(ids) > rules["max_keepers"]:
            raise HTTPException(status_code=400, detail=f"You can keep at most {rules['max_keepers']} player(s)")

        pool_rows = await _get_roster_pool(conn, owner_id, active_season, league_id)
        pool_by_id = {r["espn_player_id"]: r for r in pool_rows}
        prior = await keeper_queries.get_prior_season_selections(conn, owner_id, prior_season, league_id)
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

        updated = await keeper_queries.replace_selections(conn, active_season, owner_id, players, league_id)

    return {"selections": [dict(r) | {"created_at": r["created_at"].isoformat()} for r in updated]}


@router.get("/rules")
async def get_keeper_rules(request: Request, pool=Depends(get_pool)):
    """Read access open to any member (mirrors league_settings.py's own
    GET /league/scoring-rules, including resolving ACTIVE_SEASON
    server-side rather than taking it from the caller) — the
    commissioner-only Keeper Rules UI (2026-09-03) needs to pre-fill
    its edit form with whatever's currently configured, same shape
    GET /me's own embedded `rules` already returns for the owner-facing
    keeper-picker panel."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        row = await keeper_queries.get_rules(conn, season, league_id)
    return _rules_dict(row, season)


class KeeperRulesBody(BaseModel):
    season: int
    max_keepers: int
    max_consecutive_years: int | None = None
    keeper_deadline: datetime.datetime | None = None


@router.put("/rules")
async def set_keeper_rules(body: KeeperRulesBody, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    if body.max_keepers < 0:
        raise HTTPException(status_code=400, detail="max_keepers can't be negative")
    if body.max_consecutive_years is not None and body.max_consecutive_years < 1:
        raise HTTPException(status_code=400, detail="max_consecutive_years must be at least 1")

    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        row = await keeper_queries.upsert_rules(
            conn, body.season, body.max_keepers, body.max_consecutive_years, body.keeper_deadline, league_id
        )
    if row is None:
        raise HTTPException(status_code=409, detail="Rules are locked for this season — unlock first to change them")
    return _rules_dict(row, body.season)


class SeasonBody(BaseModel):
    season: int


@router.post("/rules/lock")
async def lock_keeper_rules(body: SeasonBody, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        row = await keeper_queries.lock_rules(conn, body.season, league_id)
        if row is None:
            row = await keeper_queries.get_rules(conn, body.season, league_id)
    return _rules_dict(row, body.season)


@router.post("/rules/unlock")
async def unlock_keeper_rules(body: SeasonBody, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        row = await keeper_queries.unlock_rules(conn, body.season, league_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"No keeper rules configured for {body.season}")
    return _rules_dict(row, body.season)
