"""
NFL-wide live scoreboard, for the logged-out (and supplementary
logged-in) homepage ticker, and for real Game Day detection (see
is_nfl_game_live below, app/routers/game_day.py, app/scheduler.py).
Deliberately separate from app/providers/espn/ — this hits ESPN's
public, unauthenticated sports scoreboard API (site.api.espn.com), not
the private fantasy league API (lm-api-reads.fantasy.espn.com), and
needs no ESPN_S2/SWID credentials at all. Verified live against real
data before building this (2026 preseason Week 3 scores) — see TODO.md.

get_week_scoreboard (added for Phase D/F's automatic weekly compute
wiring) is the "which ESPN event ids belong to fantasy week N" answer
that domain/weekly_stats.py's compute_week_stats() needs — verified
live (2026-08-26) that this same endpoint accepts week/seasontype/dates
query params and returns exactly that week's real slate, with a
week.number field to cross-check against.
"""
import asyncio
import copy
import time

import httpx

SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"

# ESPN's seasontype values — 1 = preseason, 2 = regular season, 3 =
# postseason. This league's fantasy playoffs (see the owner's real
# league settings — Playoff Teams: 4, Weeks Per Playoff Matchup: 2) are
# just later regular-season NFL weeks, not real NFL postseason games,
# so REGULAR covers every fantasy week that matters, including fantasy
# playoff weeks.
SEASON_TYPE_PRESEASON = 1
SEASON_TYPE_REGULAR = 2


def is_nfl_game_live(games: list[dict]) -> bool:
    """True iff at least one real NFL game is in progress right now.
    Replaces app/game_windows.py's old day-of-week/hour heuristic (see
    TODO.md, Aug 19 2026: a game outside its fixed windows never
    triggered Game Day, and any evening in those windows with no real
    game still did) — this checks ESPN's own live status per game
    instead of guessing from the calendar."""
    return any(g.get("state") == "in" for g in games)


def is_week_final(games: list[dict]) -> bool:
    """True once every real NFL game in this week's slate has finished
    (ESPN's own `completed` flag). True — not blocking — when there's
    no real game data at all for this week/season (nothing to gate
    against, e.g. a historical/test season or a week ESPN has no slate
    for yet); False only when real games exist and at least one hasn't
    finished, the actual "still live or upcoming" case.

    2026-09-09 fix: several "has this week been scored" checks in this
    app (get_standings, weekly_awards._load_week_context,
    weekly_team_stats.py's power/luck/chaos/sos computations) used
    `home_score > 0` as a proxy for "this result is decided." That was
    true back when scores only ever arrived as ESPN's own already-final
    box scores, but broke the instant matchups.home_score started being
    recomputed live, in-progress, every sync tick (this app's own
    ESPN-independent scoring engine, app/domain/matchup_scoring.py) —
    a single point ahead mid-game satisfied `home_score > 0` and got
    reported as a real win. This is the real "is it actually decided
    yet" check those call sites need instead."""
    if not games:
        return True
    return all(g.get("completed") for g in games)


def _parse_scoreboard_events(data: dict) -> list[dict]:
    games = []
    for event in data.get("events", []):
        competitions = event.get("competitions") or []
        if not competitions:
            continue
        competition = competitions[0]
        competitors = competition.get("competitors", [])
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue

        status = competition.get("status", {})
        status_type = status.get("type", {})

        # Real-time possession/red-zone, present whenever the game is
        # actually in progress — ESPN's own "situation" object on this
        # same endpoint. situation.possession is a team ID (not an
        # abbreviation), resolved against these same two competitors'
        # own team.id rather than a separate global id->abbreviation
        # table, since both are always right here. This is what lets
        # app/domain/nfl_schedule.py's live_status_by_pro_team work for
        # EVERY live game from this one already-continuous, un-gated
        # poll, instead of only games someone happens to have a
        # specific Gamecast screen open for — a real report, 2026-09-13:
        # CHI@CAR was genuinely live and simply never showed up as live
        # anywhere in the app, because Gamecast's own cache (deliberately
        # viewer-gated, see scheduler.py) had never been asked to track it.
        situation = competition.get("situation") or {}
        possession_team_id = situation.get("possession")
        possession_team_abbr = None
        if possession_team_id:
            for competitor in (home, away):
                if competitor.get("team", {}).get("id") == possession_team_id:
                    possession_team_abbr = competitor.get("team", {}).get("abbreviation")
                    break

        games.append(
            {
                "id": event.get("id"),
                "name": event.get("name"),
                "home_team": home.get("team", {}).get("abbreviation"),
                "home_score": home.get("score"),
                "away_team": away.get("team", {}).get("abbreviation"),
                "away_score": away.get("score"),
                "state": status_type.get("state"),  # "pre" | "in" | "post"
                "status_detail": status_type.get("shortDetail"),
                "completed": status_type.get("completed", False),
                # Game clock for live projections (app/domain/
                # live_projection.py): quarter (5+ = overtime, 0 before
                # kickoff) and seconds left in it.
                "period": status.get("period") or 0,
                "clock": float(status.get("clock") or 0),
                # Real ISO8601 UTC kickoff time — e.g. "2026-08-21T00:00Z".
                # Not surfaced to the frontend (the ticker only needs
                # status_detail's human string); used by
                # app/domain/chug_deadline.py to find the real Monday
                # Night Football kickoff for Jeffrey's Rule's deadline.
                "date": event.get("date"),
                "possession_team_abbr": possession_team_abbr,
                "is_redzone": bool(situation.get("isRedZone")),
            }
        )
    return games


# Short-lived, per-process cache in front of both scoreboard fetches.
# ~30 call sites hit this endpoint, and a single Home page load used to
# fire five or so identical ESPN requests at once (/me/week, the league
# ticker, matchup-context, awards, ...) — each one a fresh TLS handshake
# to ESPN, and together the bulk of those endpoints' response time
# (2026-09 load-time pass: matchup-context averaged 2.5s in Railway's
# slow-request log). 15 seconds is well inside how often anything
# downstream polls for live scores, and short enough that a game going
# final is picked up by the next scheduler run anyway. Concurrent
# misses for the same key share one in-flight request instead of each
# starting their own. Failures are never cached.
_CACHE_TTL_SECONDS = 15.0
_cache: dict[tuple, tuple[float, list[dict]]] = {}
_inflight: dict[tuple, asyncio.Task] = {}


def clear_scoreboard_cache() -> None:
    _cache.clear()
    _inflight.clear()


async def _cached_games(key: tuple, fetch) -> list[dict]:
    hit = _cache.get(key)
    if hit is not None and time.monotonic() - hit[0] < _CACHE_TTL_SECONDS:
        # Deep copy: every caller gets its own list/dicts, same as an
        # uncached fetch, so one caller mutating a game can't leak into
        # another's response.
        return copy.deepcopy(hit[1])
    task = _inflight.get(key)
    if task is None:
        task = asyncio.ensure_future(fetch())
        _inflight[key] = task

        def _store(t: asyncio.Task) -> None:
            _inflight.pop(key, None)
            if not t.cancelled() and t.exception() is None:
                _cache[key] = (time.monotonic(), t.result())

        task.add_done_callback(_store)
    # shield: one caller's request being cancelled (a client
    # disconnecting mid-load) mustn't cancel the fetch the other callers
    # sharing it are still waiting on.
    return copy.deepcopy(await asyncio.shield(task))


async def _fetch_scoreboard(params: dict | None) -> list[dict]:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await (client.get(SCOREBOARD_URL, params=params) if params else client.get(SCOREBOARD_URL))
        response.raise_for_status()
        return _parse_scoreboard_events(response.json())


async def get_nfl_scoreboard() -> list[dict]:
    return await _cached_games(("live",), lambda: _fetch_scoreboard(None))


async def get_week_scoreboard(week: int, year: int, season_type: int = SEASON_TYPE_REGULAR) -> list[dict]:
    """Same normalized shape as get_nfl_scoreboard(), but for a
    specific week/season/season-type instead of whatever's happening
    right now — the source of event ids for
    app/domain/weekly_stats.py's compute_week_stats()."""
    params = {"week": week, "seasontype": season_type, "dates": year}
    return await _cached_games(("week", week, year, season_type), lambda: _fetch_scoreboard(params))


async def get_real_current_week() -> int | None:
    """The real NFL week happening right now, straight off this same
    public, keyless scoreboard endpoint's own top-level `week.number`
    field (verified live 2026-09-08: {"week": {"number": 1}, "season":
    {"type": 2, "year": 2026}} a week before Week 1 kickoff).

    Replaces every real caller's former use of ESPNProvider.
    get_current_week (app/providers/espn/adapter.py), which read
    league.current_week off the private, unofficial fantasy-league API
    — this app's second real ESPN dependency the competitive audit's
    schedule/playoff finding didn't originally name: "what NFL week is
    it" is a real, league-agnostic fact, not something that should ever
    require a specific private fantasy league's own credentials to
    answer. Every one of app/scheduler.py's live-sync/weekly-compute
    jobs and app/routers/admin.py's matching manual triggers now call
    this instead.

    Returns None outside the real NFL regular season (season.type != 2,
    i.e. preseason or postseason) — this app's fantasy weeks only ever
    correspond to real regular-season NFL weeks (see
    SEASON_TYPE_REGULAR above), so None here means "no real current
    fantasy week to sync/compute," not a guess."""
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(SCOREBOARD_URL)
        response.raise_for_status()
        data = response.json()
    if data.get("season", {}).get("type") != SEASON_TYPE_REGULAR:
        return None
    return data.get("week", {}).get("number")
