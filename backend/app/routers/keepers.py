"""Keeper-league tracking — owners pick their keepers for the upcoming
draft from the roster they actually had at the END OF LAST SEASON (not
this season's in-app roster, which is empty for everyone until the
draft actually happens — a keeper pick is what carries a player INTO
that draft, so "this season's roster" can't be the source it's picked
from), the commissioner configures how many keepers are allowed, any
cap on consecutive years the same player can be kept, and the
selection deadline, then locks the window once it's final.

Owner-facing routes resolve owner_id from the session only, same
"no owner_id from the caller" discipline as app/routers/settings.py.
Commissioner routes use a live per-league check (app/auth/
league_context.py) instead of the old global is_commissioner session
flag — see TODO.md's PHASE 9 entry. Every route also resolves
league_id from the session, never a client-supplied value.

ROSTER POOL SOURCE — ESPN, for the PRIOR season specifically (see
_get_roster_pool): this league played last season on ESPN, before this
app's own in-app draft/roster system existed, so "the roster you had
at the end of last season" only exists on ESPN's side, keyed by
espn_team_id — the real, stable per-season slot ESPN itself assigns
(teams_by_season.espn_team_id), which _get_roster_pool resolves via
THIS season's own team row, not by assuming owner_id stayed the same
across the two seasons (see that function's own docstring, 2026-09: an
ownership handoff — a departed member's team taken over by a real
replacement this season — is a normal, real event this league goes
through, and the new owner still needs last season's real roster to
pick a keeper from without any historical row being rewritten to
"become" them). Two real production bugs this went through before
landing here (2026-09-04, "a user's keeper roster isn't showing," then
"actually needs to be last season's ESPN roster, not this app's own"):

  1. First version hit ESPNLineupClient.get_roster(espn_team_id,
     ACTIVE_season) — a LIVE read against the CURRENT season. Silently
     empty for a team with a synthetic espn_team_id (any self-serve-
     created team — app/queries/teams.py's create_team) and stale for
     anyone whose real roster has since moved in-app, but neither of
     those is actually the bug that mattered: this season's roster is
     supposed to be empty right now, since the draft that would fill
     it hasn't happened yet.
  2. Second version read this app's own current_rosters for the
     ACTIVE season — same fundamental problem from the other
     direction: current_rosters for a season is only ever populated
     BY that season's draft, so querying it to decide who's eligible
     to BE drafted (as a kept player) is circular. Wrong table.

This version resolves the owner's PRIOR-season teams_by_season row and
reads ESPN for THAT season specifically — a real, closed season ESPN
reliably serves regardless of what's happened in this app since, which
is exactly what "the roster you had last season" means. Empty list
(not an error) if the owner has no team in the prior season — a
genuine new franchise has nothing to keep from, correctly.

keeper_selections carries a player's identity forward year over year as
espn_player_id (not sleeper_player_id) — ESPN's own roster read already
returns that directly (RosterEntry.player_id), no crosswalk needed here
the way app/domain/draft_engine.py's seed_keepers_from_locked_selections
needs one (that path starts from a stored espn_player_id and has to
resolve INTO this app's own sleeper_player_id space to make a real
draft pick; this path starts from ESPN and never needs to leave it).

ESPN write-back (pushing locked selections into ESPN's own copy of the
league) is intentionally NOT implemented here — this league's real
draft/rosters going forward are no longer ESPN's, so there's nothing on
ESPN's side left to write back to. This router is fully functional as
an in-app system of record on its own.
"""
import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id, require_league_commissioner
from app.auth.session import decode_session_token, get_session_token
from app.config import _require
from app.db import get_pool
from app.providers.espn.lineup_client import ESPNLineupClient
from app.providers.espn.slots import slot_label
from app.queries import draft as draft_queries
from app.queries import keepers as keeper_queries
from app.queries import league as league_queries

router = APIRouter(prefix="/keepers", tags=["keepers"])

_NON_POSITION_SLOT_LABELS = {"BE", "IR", "RB/WR/TE"}  # bench/IR/flex aren't a real position


def _infer_position(eligible_slot_ids: tuple[int, ...]) -> str:
    """A RosterEntry has no dedicated position field — its real
    position is whichever eligible slot isn't bench/IR/flex (an RB's
    own eligible slots are always {RB, RB/WR/TE, BE, IR}, so RB is the
    one real-position label in that set)."""
    for slot_id in eligible_slot_ids:
        label = slot_label(slot_id)
        if label not in _NON_POSITION_SLOT_LABELS:
            return label
    return "—"


async def _get_roster_pool(conn, owner_id: int, active_season: int, league_id: int) -> list[dict]:
    """The players an owner can choose a keeper from — their real ESPN
    roster as it stood at the end of LAST season (see module docstring
    for why that's the prior season specifically, read from ESPN, not
    this app's own current_rosters). Empty list (not an error) if the
    owner has no team this season.

    Resolves via THIS SEASON's own espn_team_id, then reads ESPN for
    that same id one season back — not by matching owner_id directly
    across seasons (what this did before 2026-09). espn_team_id is the
    real, stable franchise slot (ESPN's own numbering); owner_id is not
    guaranteed stable across an ownership handoff — a new owner taking
    over an existing team this season (e.g. a departed member's spot
    handed to a real replacement, teams_by_season.espn_team_id carried
    forward, owner_id genuinely different) still needs last season's
    real roster to pick a keeper from, without any historical row
    having to be rewritten to "become" them — the commissioner
    explicitly asked for exactly that (owners.user_id / historical
    owner_id values must stay exactly as-is; only the roster the new
    owner can pick from should follow the team). For every ordinary
    continuing owner (the common case, owner_id AND espn_team_id both
    unchanged year over year) this returns identically to the old
    owner_id-matched lookup — this is a generalization, not a special
    case."""
    prior_season = active_season - 1
    current_team = await league_queries.get_team_for_owner(conn, active_season, owner_id, league_id)
    if current_team is None:
        return []

    client = ESPNLineupClient()
    roster = client.get_roster(current_team["espn_team_id"], prior_season)
    return [
        {
            "espn_player_id": e.player_id,
            "player_name": e.player_name,
            "position": _infer_position(e.eligible_slot_ids),
            "pro_team": e.pro_team,
        }
        for e in roster
    ]


def _decode_session(token: str | None) -> dict | None:
    if not token:
        return None
    config = SessionConfig()
    return decode_session_token(config.session_secret, token)


def _require_session(request: Request) -> dict:
    payload = _decode_session(get_session_token(request))
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
