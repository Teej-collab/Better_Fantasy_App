"""
Player card — headshot, bio, and real ESPN season/weekly point
projections + ownership% + bye week for a single player (see
app/domain/player_card.py). Signed-in only, same discipline as the
rest of the roster/draft/free-agent read paths, but not owner-scoped —
this is a read-only lookup against this league's real ESPN data and
this app's own Sleeper-sourced player table, identical for any signed-
in owner, so no owner_id is resolved here the way me.py/keepers.py do.
"""
from fastapi import APIRouter, HTTPException, Request

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id, resolve_owner_id
from app.auth.session import decode_session_token, get_session_token
from app.config import _require
from app.db import get_pool
from app.domain.player_card import get_player_card

router = APIRouter(prefix="/players", tags=["players"])


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return payload


@router.get("")
async def list_players(request: Request, position: str | None = None, search: str | None = None):
    """Every real NFL player, rostered or not — a browsable/sortable
    research view over the same `players` pool /me/team/free-agents
    reads (that route excludes rostered players since it's specifically
    "who can I add"; this one doesn't, since research isn't scoped to
    availability). Added 2026-09-01: the app already had rich
    per-player data (get_player_card, below) but only reachable
    one-at-a-time via a click-to-open modal — no page to browse,
    search, or sort across the whole pool, a real gap against ESPN/
    Yahoo/Sleeper's own player-research pages (2026-08-31 audit).
    Signed-in only, same discipline as the rest of this file. is_rostered
    is scoped to the caller's own real active league (require_active_league_id)
    — this used to hardcode DEFAULT_LEAGUE_ID, so any signed-in account
    (regardless of which league, or none) saw League 1's specific
    rostered/available status (2026-09 audit, smaller-severity sibling
    of league.py's finding — a boolean, not names/scores, but still
    that league's own private roster state)."""
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)

        query = """
            SELECT
                p.sleeper_player_id, p.full_name, p.position, p.pro_team,
                p.search_rank, p.injury_status,
                EXISTS (
                    SELECT 1 FROM current_rosters cr
                    WHERE cr.season = $1 AND cr.league_id = $2 AND cr.sleeper_player_id = p.sleeper_player_id
                ) AS is_rostered
            FROM players p
            WHERE p.is_draftable
        """
        params: list = [active_season, league_id]
        if position:
            query += f" AND p.position = ${len(params) + 1}"
            params.append(position)
        if search:
            query += f" AND p.full_name ILIKE ${len(params) + 1}"
            params.append(f"%{search}%")
        query += " ORDER BY p.search_rank ASC NULLS LAST, p.full_name ASC LIMIT 300"

        rows = await conn.fetch(query, *params)
    return {"players": [dict(r) for r in rows]}


@router.get("/{sleeper_player_id}/card")
async def player_card(sleeper_player_id: str, request: Request):
    # league_id scoped to the caller's own real active league
    # (require_active_league_id) — this used to silently fall back to
    # DEFAULT_LEAGUE_ID, so any signed-in account (regardless of which
    # league, or none) got League 1's own computed weekly fantasy score
    # for this player (2026-09 audit; same bug class list_players above
    # was already fixed for, just missed on this sibling route).
    payload = _require_session(request)
    active_season = int(_require("ACTIVE_SEASON"))
    pool = await get_pool()
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        my_owner_id = await resolve_owner_id(conn, payload)
        card = await get_player_card(conn, sleeper_player_id, league_id, active_season, my_owner_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Player not found")
    return card
