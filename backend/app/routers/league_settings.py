"""Scoring rules for the caller's own active league — read access is
open to any member (matches keepers.py's own /me read precedent), the
write is commissioner-only. Mirrors keepers.py's shape exactly:
league_id is always resolved from the session's active league, never
accepted from the request itself.
"""
import json
import logging
import traceback

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from app.auth.config import SessionConfig
from app.auth.league_context import require_active_league_id, require_league_commissioner
from app.auth.session import decode_session_token, get_session_token
from app.config import _require
from app import monitoring
from app.db import get_pool
from app.domain import commish_log, league_format, scoring_catalog
from app.domain.scoring_engine import compute_player_points, rules_dict_from_rows
from app.domain.stat_derivations import derive_stat_line
from app.domain.schedule_builder import build_and_save
from app.domain.schedule_exceptions import ScheduleError
from app.encryption import encrypt_secret
from app.providers.espn.adapter import ESPNProvider
from app.providers.espn.config import ESPNConfig, config_for_connection
from espn_api.requests.espn_requests import ESPNAccessDenied
from app.providers.sleeper.league import SleeperLeagueNotFound, SleeperProvider, fetch_league, parse_league_id
from app.domain import league_switch
from app.domain.league_import import PRIVATE_LEAGUE_MESSAGE, parse_espn_league_id
from app.providers.sync import run_full_sync
from app.queries import league as league_read_queries
from app.queries import league_espn_connections as espn_connection_queries
from app.queries import league_sleeper_connections as sleeper_connection_queries
from app.queries import leagues as league_queries

router = APIRouter(prefix="/league", tags=["league-settings"])
logger = logging.getLogger(__name__)


def _require_session(request: Request) -> dict:
    token = get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    config = SessionConfig()
    payload = decode_session_token(config.session_secret, token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return payload


# The league's own chat-filter words (app/moderation.py), on top of the
# built-in list every league gets. Commissioner-only; the built-in list
# isn't shown or editable.
MAX_FILTER_WORDS = 200


class ChatFilterRequest(BaseModel):
    words: list[str]


@router.get("/chat-filter")
async def get_chat_filter(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        words = await conn.fetchval("SELECT words FROM league_chat_filter_words WHERE league_id = $1", league_id)
    return {"words": list(words or [])}


@router.put("/chat-filter")
async def update_chat_filter(body: ChatFilterRequest, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    words: list[str] = []
    for raw in body.words:
        word = raw.strip().lower()
        if not word or word in words:
            continue
        if len(word) > 40 or " " in word:
            raise HTTPException(status_code=400, detail="Each filter entry is one word, up to 40 characters")
        words.append(word)
    if len(words) > MAX_FILTER_WORDS:
        raise HTTPException(status_code=400, detail=f"The filter holds up to {MAX_FILTER_WORDS} words")
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        before = set(await conn.fetchval("SELECT words FROM league_chat_filter_words WHERE league_id = $1", league_id) or [])
        await conn.execute(
            """
            INSERT INTO league_chat_filter_words (league_id, words) VALUES ($1, $2)
            ON CONFLICT (league_id) DO UPDATE SET words = EXCLUDED.words, updated_at = now()
            """,
            league_id, words,
        )
        added, removed = len(set(words) - before), len(before - set(words))
        if added or removed:
            parts = ([f"added {added} word{'s' if added != 1 else ''}"] if added else []) + (
                [f"removed {removed} word{'s' if removed != 1 else ''}"] if removed else []
            )
            # The words themselves stay out of the log: members can read it.
            await commish_log.record(conn, league_id, payload["user_id"], "chat", "Chat filter: " + " and ".join(parts))
    return {"words": words}


@router.get("/scoring-rules")
async def get_scoring_rules(request: Request, season: int | None = None, pool=Depends(get_pool)):
    payload = _require_session(request)
    # Defaults to the active season (existing behavior, e.g. the
    # Commissioner editor) — an explicit ?season= lets a caller resolve
    # the real rates for a *past* season's matchup (a per-player score
    # breakdown on an old week needs that season's own rules, which can
    # differ after a mid-season change — see upsert_scoring_rules).
    resolved_season = season if season is not None else int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        rows = await league_queries.get_scoring_rules(conn, league_id, resolved_season)
    return {"season": resolved_season, "rules": [dict(r) for r in rows]}


class ScoringRulesRequest(BaseModel):
    season: int
    rules: dict[str, float]


@router.put("/scoring-rules")
async def update_scoring_rules(body: ScoringRulesRequest, request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        before = {
            r["stat_category"]: float(r["points_per_unit"])
            for r in await league_queries.get_scoring_rules(conn, league_id, body.season)
        }
        await league_queries.upsert_scoring_rules(conn, league_id, body.season, body.rules)
        rows = await league_queries.get_scoring_rules(conn, league_id, body.season)
        after = {r["stat_category"]: float(r["points_per_unit"]) for r in rows}
        changes = []
        for key in sorted(set(before) | set(after)):
            if before.get(key) != after.get(key):
                label = scoring_catalog.CATALOG.get(key, {}).get("label", key)
                old = "not scored" if key not in before else f"{before[key]:g}"
                new = "not scored" if key not in after else f"{after[key]:g}"
                changes.append(f"{label}: {old} → {new}")
        if changes:
            shown = changes[:6] + ([f"and {len(changes) - 6} more"] if len(changes) > 6 else [])
            await commish_log.record(conn, league_id, payload["user_id"], "scoring", "Scoring: " + "; ".join(shown))
    return {"season": body.season, "rules": [dict(r) for r in rows]}


@router.get("/scoring-catalog")
async def get_scoring_catalog(request: Request, pool=Depends(get_pool)):
    """The scoring editor (2026-10): every stat a league can score,
    grouped by tab, with this league's value and whether we track it."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        rules = rules_dict_from_rows(await league_queries.get_scoring_rules(conn, league_id, season))
        fmt = await league_format.get_league_format(conn, league_id)
    return {
        "season": season,
        "groups": [{"key": g, "label": scoring_catalog.GROUP_LABELS[g]} for g in scoring_catalog.GROUPS],
        "stats": scoring_catalog.catalog_with_rules(rules),
        "idp": fmt["roster_preset"] == "idp",
    }


class ScoringPreviewRequest(BaseModel):
    rules: dict[str, float]


@router.post("/scoring-preview")
async def scoring_preview(body: ScoringPreviewRequest, request: Request, pool=Depends(get_pool)):
    """Real players' latest week, rescored under the rules being edited
    — the editor's live preview. The players whose score moves most
    come first (so a new rule shows someone it affects), then each
    position's top scorer."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        current = rules_dict_from_rows(await league_queries.get_scoring_rules(conn, league_id, season))
        week = await conn.fetchval(
            "SELECT max(week) FROM player_week_stats WHERE season = $1 AND league_id = $2", season, league_id
        )
        if week is None:
            return {"week": None, "players": []}
        rows = await conn.fetch(
            """
            SELECT s.sleeper_player_id, s.raw_stats, p.full_name, p.position, p.pro_team
            FROM player_week_stats s JOIN players p ON p.sleeper_player_id = s.sleeper_player_id
            WHERE s.season = $1 AND s.week = $2 AND s.league_id = $3
            """,
            season, week, league_id,
        )
    proposed = {**current, **body.rules}
    scored = []
    for r in rows:
        stats = r["raw_stats"] if isinstance(r["raw_stats"], dict) else json.loads(r["raw_stats"] or "{}")
        line = derive_stat_line(stats, r["position"]) if r["position"] != "DEF" else stats
        before, after = compute_player_points(line, current), compute_player_points(line, proposed)
        scored.append({
            "sleeper_player_id": r["sleeper_player_id"], "name": r["full_name"], "position": r["position"],
            "pro_team": r["pro_team"], "stats": {k: v for k, v in line.items() if v}, "before": before, "after": after,
        })
    movers = sorted((p for p in scored if p["after"] != p["before"]), key=lambda p: -abs(p["after"] - p["before"]))[:4]
    leaders = []
    for position in ("QB", "RB", "WR", "TE", "K", "DEF"):
        best = max((p for p in scored if p["position"] == position), key=lambda p: p["after"], default=None)
        if best and best not in movers:
            leaders.append(best)
    return {"week": week, "players": (movers + leaders)[:8]}


class ScoringRequest(BaseModel):
    message: str


@router.post("/scoring-requests")
async def request_scoring_stat(body: ScoringRequest, request: Request, pool=Depends(get_pool)):
    """A stat the scoring editor can't offer yet ("Request"): lands in
    the feedback inbox the site owner already reads."""
    message = body.message.strip()[:500]
    if not message:
        raise HTTPException(status_code=400, detail="Say which stat you'd like to score")
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        user = await conn.fetchrow("SELECT display_name FROM users WHERE id = $1", payload["user_id"])
        await conn.execute(
            "INSERT INTO feedback (user_id, submitted_by, message, page_url) VALUES ($1, $2, $3, $4)",
            payload["user_id"], (user["display_name"] if user else None) or "Commissioner",
            f"[Scoring stat request, league {league_id}] {message}", "/commissioner/scoring",
        )
    return {"status": "ok"}


@router.get("/playoff-settings")
async def get_playoff_settings(request: Request, pool=Depends(get_pool)):
    """Read access open to any member, same as GET /scoring-rules —
    the commissioner-only edit form uses this to pre-fill, but the
    setting itself (via queries/league.py's get_playoff_settings)
    already powers the public standings page's playoff-line divider,
    and now app/domain/playoffs.py's bracket generator."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        settings = await league_read_queries.get_playoff_settings(conn, season, league_id)
    return {"season": season, **settings}


class PlayoffSettingsRequest(BaseModel):
    season: int
    playoff_team_count: int
    # This league's real ESPN settings (the commissioner's own
    # screenshot): weeks_per_matchup=2. Defaults preserve the prior
    # single-field form's behavior for anyone not yet sending them.
    weeks_per_matchup: int = 1
    start_week: int | None = None


@router.put("/playoff-settings")
async def update_playoff_settings(body: PlayoffSettingsRequest, request: Request, pool=Depends(get_pool)):
    if body.playoff_team_count <= 0:
        raise HTTPException(status_code=400, detail="playoff_team_count must be positive")
    if body.weeks_per_matchup <= 0:
        raise HTTPException(status_code=400, detail="weeks_per_matchup must be positive")
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        before = await league_read_queries.get_playoff_settings(conn, body.season, league_id)
        await league_queries.set_playoff_team_count(
            conn, league_id, body.season, body.playoff_team_count, body.weeks_per_matchup, body.start_week,
        )
        changes = [
            commish_log.change("Playoff teams", before["playoff_team_count"], body.playoff_team_count),
            commish_log.change("Weeks per playoff round", before["weeks_per_matchup"], body.weeks_per_matchup),
            commish_log.change(
                "Playoffs start", f"Week {before['start_week']}" if before["start_week"] else "after the regular season",
                f"Week {body.start_week}" if body.start_week else "after the regular season",
            ),
        ]
        changes = [c for c in changes if c]
        if changes:
            await commish_log.record(conn, league_id, payload["user_id"], "playoffs", "; ".join(changes))
    return {
        "season": body.season,
        "playoff_team_count": body.playoff_team_count,
        "weeks_per_matchup": body.weeks_per_matchup,
        "start_week": body.start_week,
    }


class GenerateScheduleRequest(BaseModel):
    season: int
    weeks: int


@router.post("/schedule/generate")
async def generate_schedule(body: GenerateScheduleRequest, request: Request, pool=Depends(get_pool)):
    """Real write — generates this season's real regular-season matchup
    schedule in-app (app/domain/schedule_builder.py), no ESPN read involved.
    Only ever makes sense for a season that hasn't been scheduled yet
    (typically right after teams exist, e.g. right after the draft) —
    refuses with 409 if regular-season matchups already exist for this
    season, rather than silently overwriting a real, possibly-already-
    played schedule."""
    if body.weeks <= 0:
        raise HTTPException(status_code=400, detail="weeks must be positive")
    payload = _require_session(request)
    try:
        async with pool.acquire() as conn:
            league_id = await require_league_commissioner(conn, payload)
            created = await build_and_save(conn, body.season, league_id, body.weeks)
            await commish_log.record(
                conn, league_id, payload["user_id"], "league", f"Made the {body.weeks}-week regular-season schedule"
            )
    except ScheduleError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return {"season": body.season, "weeks": body.weeks, "matchups": created}


# --- ESPN connection (Phase 6 of the multi-league migration — see
# TODO.md's PHASE 9 entry). Lets a league other than League #1 import
# its own real ESPN league, instead of ESPN_LEAGUE_ID/ESPN_S2/
# ESPN_SWID only ever describing one global league. This on-demand
# manual sync is deliberately still here even though app/scheduler.py's
# full/live sync jobs now also iterate every connected league
# automatically (same day, same phase) — a commissioner who just
# connected wants to see real data immediately, not wait for the next
# scheduled tick (schedulers are off by default in dev anyway — see
# AGENTS.md). Week settlement and weekly compute needed no scheduler
# changes at all — both were already fully multi-league (DB-only
# compute, no ESPN calls, already looping every league with real teams
# for the season).


class ConnectEspnRequest(BaseModel):
    # The league's ID, or (2026-10-24) its link pasted straight from ESPN
    # (…/football/league?leagueId=12345). One of the two is required.
    espn_league_id: int | None = None
    league_url: str | None = None
    # Only a private league needs these; a public one connects without.
    espn_s2: str | None = None
    espn_swid: str | None = None


def _espn_league_id(body: ConnectEspnRequest) -> int:
    if body.espn_league_id:
        return body.espn_league_id
    league_id = parse_espn_league_id(body.league_url or "")
    if league_id is None:
        raise HTTPException(
            status_code=400,
            detail="Paste your league's link from ESPN (it has leagueId= in it), or just the number.",
        )
    return league_id


@router.get("/espn-connection")
async def get_espn_connection(request: Request, pool=Depends(get_pool)):
    """Read access open to any member, same precedent as scoring-rules/
    playoff-settings above. Never returns the decrypted credentials —
    write-only past the moment they're saved — just enough for the
    commissioner-only UI to show connection status."""
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        row = await espn_connection_queries.get_connection(conn, league_id)
    if row is None:
        return {"connected": False}
    return {
        "connected": True,
        "espn_league_id": row["espn_league_id"],
        # Connected by link alone, no cookies (a public ESPN league).
        "public": row["espn_s2_encrypted"] is None,
        "last_synced_at": row["last_synced_at"],
        "last_sync_error": row["last_sync_error"],
    }


@router.post("/espn-connection")
async def connect_espn(body: ConnectEspnRequest, request: Request, pool=Depends(get_pool)):
    """Validates the given credentials against a real ESPN fetch BEFORE
    saving anything (ESPNProvider.get_current_week, the cheapest real
    call that still exercises the same League(...) construction every
    sync step depends on) — a bad League ID/S2/SWID fails loud here, at
    connect time, rather than silently at the next sync. Encrypts
    espn_s2/swid at rest (app/encryption.py) — the first real per-user
    credential this app stores in its own database rather than only
    ever reading from an env var."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    espn_league_id = _espn_league_id(body)
    s2 = (body.espn_s2 or "").strip()
    swid = (body.espn_swid or "").strip()
    private = bool(s2 and swid)

    # A public league needs no cookies (2026-10-24): the commissioner
    # pastes the link and that's it. Empty strings make ESPN's library
    # send none.
    espn_config = ESPNConfig(league_id=espn_league_id, espn_s2=s2, swid=swid, active_season=season)
    try:
        await ESPNProvider(espn_config).get_current_week(season)
    except ESPNAccessDenied as e:
        if private:
            raise HTTPException(
                status_code=400,
                detail="ESPN didn't accept those sign-in values. Copy espn_s2 and SWID again and retry.",
            ) from e
        raise HTTPException(
            status_code=400,
            detail=PRIVATE_LEAGUE_MESSAGE,
        ) from e
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail="Couldn't find that ESPN league. Check the link and try again.",
        ) from e

    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        if await sleeper_connection_queries.get_connection(conn, league_id):
            raise HTTPException(status_code=409, detail="This league is connected to Sleeper. Disconnect it first.")
        try:
            row = await espn_connection_queries.upsert_connection(
                conn, league_id, espn_league_id,
                encrypt_secret(s2) if private else None, encrypt_secret(swid) if private else None,
                payload["user_id"],
            )
        except Exception as e:
            # Our side, not theirs (2026-10-27: the encryption key was
            # missing on the server). Say so plainly, and still log it and
            # alert the admins the way an unhandled 500 would.
            monitoring.run_in_background(monitoring._record_server_error(
                f"{type(e).__name__}: {e}", traceback.format_exc(), "/league/espn-connection", "POST", 503,
                payload["user_id"],
            ))
            raise HTTPException(
                status_code=503,
                detail="We found your league but couldn't finish connecting it on our end. "
                "We've been alerted. Try again in a few minutes.",
            ) from e
        await commish_log.record(conn, league_id, payload["user_id"], "espn", f"Connected ESPN league {espn_league_id}")
    return {"connected": True, "espn_league_id": row["espn_league_id"]}


@router.delete("/espn-connection")
async def disconnect_espn(request: Request, pool=Depends(get_pool)):
    """Removes the connection only — never touches whatever this league
    already synced from it (teams_by_season, matchups, rosters, ...),
    same "disconnecting a source never deletes the data it produced"
    posture as every other integration in this app."""
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        await espn_connection_queries.delete_connection(conn, league_id)
        await commish_log.record(conn, league_id, payload["user_id"], "espn", "Disconnected ESPN")
    return Response(status_code=204)


@router.post("/espn-connection/sync")
async def sync_espn_now(request: Request, pool=Depends(get_pool)):
    """Commissioner-triggered, on-demand sync for this league's own
    connected ESPN league — the per-league counterpart to admin.py's
    League #1-only POST /admin/sync. Only ever syncs the active season,
    never a historical backfill range (see ESPNConfig's own docstring)
    — a newly-connected league's most useful first sync is "what does
    my league look like right now," and run_full_sync's per-step
    try/except means a partial failure here still returns whatever DID
    succeed rather than an all-or-nothing 500.

    last_sync_error tracks the "teams" step specifically as this sync's
    overall health signal, not every step — a teams-sync failure means
    the ESPN connection itself is broken (expired S2/SWID, league ID
    changed), the one failure mode a commissioner actually needs to act
    on; a downstream compute step failing on its own real bug is a
    backend concern, not a "reconnect your ESPN league" one."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))

    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        connection = await espn_connection_queries.get_connection(conn, league_id)
    if connection is None:
        raise HTTPException(status_code=409, detail="Connect an ESPN league first")

    try:
        espn_config = config_for_connection(connection, season)
        results = await run_full_sync(ESPNProvider(espn_config), season, season, league_id=league_id)
        await _mirror_refresh(pool, league_id, season)
    except Exception as e:
        async with pool.acquire() as conn:
            await espn_connection_queries.mark_sync_failure(conn, league_id, str(e))
        raise HTTPException(status_code=502, detail=f"Sync failed: {e}") from e

    teams_result = results.get(season, {}).get("teams", {})
    async with pool.acquire() as conn:
        if teams_result.get("status") == "failed":
            await espn_connection_queries.mark_sync_failure(conn, league_id, teams_result.get("detail", "Sync failed"))
        else:
            await espn_connection_queries.mark_sync_success(conn, league_id)
    return {"season": season, "results": results}



# ---- Sleeper (2026-10-24) ------------------------------------------------
# A league brought in from Sleeper, synced like an ESPN one (app/providers/
# sleeper/league.py). Sleeper's league API is public: no sign-in values,
# just the league's link or id.


class ConnectSleeperRequest(BaseModel):
    league: str


@router.get("/sleeper-connection")
async def get_sleeper_connection(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        row = await sleeper_connection_queries.get_connection(conn, league_id)
    if row is None:
        return {"connected": False}
    return {
        "connected": True,
        "sleeper_league_id": row["sleeper_league_id"],
        "league_name": row["league_name"],
        "last_synced_at": row["last_synced_at"],
        "last_sync_error": row["last_sync_error"],
    }


@router.post("/sleeper-connection")
async def connect_sleeper(body: ConnectSleeperRequest, request: Request, pool=Depends(get_pool)):
    """Checks the league exists on Sleeper and is this season's before
    saving, then syncs it straight away so the league fills in on the
    spot (a failed first sync still keeps the connection, with the
    error shown, for a retry)."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    sleeper_league_id = parse_league_id(body.league)
    if sleeper_league_id is None:
        raise HTTPException(
            status_code=400,
            detail="Paste your league's link from Sleeper (sleeper.com/leagues/…) or its league ID.",
        )
    try:
        sleeper_league = await fetch_league(sleeper_league_id)
    except SleeperLeagueNotFound as e:
        raise HTTPException(status_code=400, detail="Couldn't find that league on Sleeper. Check the link.") from e
    if str(sleeper_league.get("season")) != str(season):
        raise HTTPException(
            status_code=400,
            detail=f"That's Sleeper's {sleeper_league.get('season')} league. Use your {season} league's link.",
        )

    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        if await espn_connection_queries.get_connection(conn, league_id):
            raise HTTPException(status_code=409, detail="This league is connected to ESPN. Disconnect it first.")
        await sleeper_connection_queries.upsert_connection(
            conn, league_id, sleeper_league_id, sleeper_league.get("name"), payload["user_id"]
        )
        await commish_log.record(
            conn, league_id, payload["user_id"], "league", f"Connected Sleeper league {sleeper_league.get('name') or sleeper_league_id}"
        )

    results = await run_full_sync(SleeperProvider(sleeper_league_id), season, season, league_id=league_id)
    await _mirror_refresh(pool, league_id, season)
    teams_result = results.get(season, {}).get("teams", {})
    async with pool.acquire() as conn:
        if teams_result.get("status") == "failed":
            await sleeper_connection_queries.mark_sync_failure(conn, league_id, teams_result.get("detail", "Sync failed"))
        else:
            await sleeper_connection_queries.mark_sync_success(conn, league_id)
    return {"connected": True, "sleeper_league_id": sleeper_league_id, "league_name": sleeper_league.get("name")}


@router.delete("/sleeper-connection")
async def disconnect_sleeper(request: Request, pool=Depends(get_pool)):
    """Removes the connection only; what it already synced stays."""
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        await sleeper_connection_queries.delete_connection(conn, league_id)
        await commish_log.record(conn, league_id, payload["user_id"], "league", "Disconnected Sleeper")
    return Response(status_code=204)


@router.post("/sleeper-connection/sync")
async def sync_sleeper_now(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        connection = await sleeper_connection_queries.get_connection(conn, league_id)
    if connection is None:
        raise HTTPException(status_code=409, detail="Connect a Sleeper league first")
    results = await run_full_sync(SleeperProvider(connection["sleeper_league_id"]), season, season, league_id=league_id)
    await _mirror_refresh(pool, league_id, season)
    teams_result = results.get(season, {}).get("teams", {})
    async with pool.acquire() as conn:
        if teams_result.get("status") == "failed":
            await sleeper_connection_queries.mark_sync_failure(conn, league_id, teams_result.get("detail", "Sync failed"))
        else:
            await sleeper_connection_queries.mark_sync_success(conn, league_id)
    return {"season": season, "results": results}



async def _mirror_refresh(pool, league_id: int, season: int) -> None:
    """After a sync: the league's rosters and rules copied over (mirror
    mode, app/domain/league_switch.py). Never fails the sync itself."""
    try:
        await league_switch.refresh(pool, league_id, season, settings=True)
    except Exception:
        logger.exception("Mirror refresh failed (league %s)", league_id)


# ---- Moving over to The Weekend (2026-10-24) --------------------------------------


@router.get("/switch")
async def switch_status(request: Request, pool=Depends(get_pool)):
    """Whether this league is still mirroring ESPN/Sleeper, who's here,
    what couldn't be matched exactly and any switch that's set. Any
    member (the app shows the mirror banner from it)."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_active_league_id(conn, payload)
        return await league_switch.status(conn, league_id, season)


@router.post("/switch")
async def switch_league(request: Request, pool=Depends(get_pool)):
    """The commissioner moves the league over for good: now if this
    week hasn't kicked off, otherwise at the start of next week."""
    payload = _require_session(request)
    season = int(_require("ACTIVE_SEASON"))
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        week = await league_read_queries.get_cached_current_week(conn, season) or 1
    try:
        result = await league_switch.request(pool, league_id, season, payload["user_id"], week)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    async with pool.acquire() as conn:
        result["status"] = await league_switch.status(conn, league_id, season)
    return result


@router.delete("/switch")
async def cancel_switch(request: Request, pool=Depends(get_pool)):
    payload = _require_session(request)
    async with pool.acquire() as conn:
        league_id = await require_league_commissioner(conn, payload)
        await league_switch.cancel(conn, league_id)
    return Response(status_code=204)
