"""
What the Commissioner Tools screens read (2026-10-23 overhaul): the hub's
"Needs you" list and one-line summary of every tool, the members list
with each member's team and when they were last around, the season
calendar, and the trade review board with each side's projected points.
Everything here is a read; the changes themselves go through each
tool's existing endpoint (or app/routers/commish.py for the new ones).
"""
import asyncio
import json
import math
import time
from datetime import datetime, timedelta, timezone

from app.domain import rivalry_detection
from app.domain import trades as trades_domain
from app.domain.waiver_settings import get_waiver_settings, next_clear
from app.providers.nfl_scoreboard import get_week_scoreboard
from app.queries import keepers as keeper_queries
from app.queries import league as league_queries
from app.queries import leagues as leagues_queries

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
OUT_STATUSES = ("Out", "IR", "Suspended", "PUP", "NFI")
INACTIVE_AFTER = timedelta(days=10)
SOON = timedelta(days=14)
LAST_NFL_WEEK = 18
_BENCHED = ("BE", "IR", "TAXI")

WAIVER_TYPE_LABELS = {"reverse": "Worst record first", "rolling": "Rolling order", "faab": "FAAB bids"}


def hour_label(hour: int) -> str:
    return f"{hour % 12 or 12}:00 {'AM' if hour < 12 else 'PM'}"


def waiver_summary(settings: dict) -> str:
    kind = WAIVER_TYPE_LABELS[settings["waiver_type"]]
    if settings["waiver_type"] == "faab":
        kind += f" (${settings['faab_budget']})"
    return f"{kind} · run {WEEKDAYS[settings['clear_weekday']][:3]} {hour_label(settings['clear_hour'])} ET"


# ---- NFL week kickoffs ------------------------------------------------

_kickoffs: dict[int, tuple[float, dict[int, datetime]]] = {}
_KICKOFFS_TTL = 6 * 3600


async def week_kickoffs(season: int) -> dict[int, datetime]:
    """{week: that week's first kickoff} for the whole regular season,
    from the ESPN scoreboard. Cached for hours: the schedule barely
    moves, and the calendar would otherwise read 18 scoreboards."""
    hit = _kickoffs.get(season)
    if hit and time.monotonic() - hit[0] < _KICKOFFS_TTL:
        return hit[1]

    async def first(week: int) -> tuple[int, datetime | None]:
        try:
            games = await get_week_scoreboard(week, season)
        except Exception:
            return week, None
        dates = []
        for game in games:
            try:
                dates.append(datetime.fromisoformat(game["date"].replace("Z", "+00:00")))
            except (KeyError, AttributeError, ValueError):
                continue
        return week, min(dates) if dates else None

    results = await asyncio.gather(*(first(w) for w in range(1, LAST_NFL_WEEK + 1)))
    out = {week: when for week, when in results if when is not None}
    if out:
        _kickoffs[season] = (time.monotonic(), out)
    return out


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


# ---- Shared reads ------------------------------------------------------


async def _last_active(conn, league_id: int) -> dict[int, datetime]:
    """{user_id: last time they used the app or site}."""
    rows = await conn.fetch(
        """
        SELECT lm.user_id, MAX(e.created_at) AS last_at
        FROM league_members lm
        JOIN owner_users ou ON ou.user_id = lm.user_id
        JOIN analytics_events e ON e.owner_id = ou.owner_id AND e.created_at > now() - interval '120 days'
        WHERE lm.league_id = $1
        GROUP BY lm.user_id
        """,
        league_id,
    )
    return {r["user_id"]: r["last_at"] for r in rows}


async def _teams_by_user(conn, league_id: int, season: int) -> dict[int, dict]:
    standings = {r["team_id"]: r for r in await league_queries.get_standings(conn, season, league_id)}
    rows = await conn.fetch(
        """
        SELECT ou.user_id, t.id AS team_id, t.team_name
        FROM teams_by_season t
        JOIN owner_users ou ON ou.owner_id = t.owner_id
        WHERE t.league_id = $1 AND t.season = $2
        """,
        league_id, season,
    )
    out = {}
    for r in rows:
        s = standings.get(r["team_id"])
        out[r["user_id"]] = {
            "team_id": r["team_id"],
            "team_name": r["team_name"],
            "wins": s["wins"] if s else 0,
            "losses": s["losses"] if s else 0,
            "ties": s["ties"] if s else 0,
        }
    return out


async def lineup_problems(conn, league_id: int, season: int, week: int | None) -> list[dict]:
    """Teams starting someone who's out or on bye this week, whose game
    hasn't started: [{team_id, team_name, players: [{name, why}]}]."""
    if week is None:
        return []
    rows = await conn.fetch(
        """
        SELECT t.id AS team_id, t.team_name, p.full_name, p.injury_status, p.pro_team,
               (b.bye_week IS NOT NULL) AS on_bye
        FROM current_rosters cr
        JOIN teams_by_season t ON t.id = cr.team_id
        JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
        LEFT JOIN team_bye_weeks b ON b.season = cr.season AND b.pro_team = p.pro_team AND b.bye_week = $3
        WHERE cr.season = $1 AND cr.league_id = $2 AND NOT (cr.lineup_slot = ANY($4::text[]))
          AND (p.injury_status = ANY($5::text[]) OR b.bye_week IS NOT NULL)
        ORDER BY t.team_name, p.full_name
        """,
        season, league_id, week, list(_BENCHED), list(OUT_STATUSES),
    )
    started = await _started_pro_teams(season, week)
    teams: dict[int, dict] = {}
    for r in rows:
        if r["pro_team"] in started:
            continue
        team = teams.setdefault(r["team_id"], {"team_id": r["team_id"], "team_name": r["team_name"], "players": []})
        team["players"].append({"name": r["full_name"], "why": "on bye" if r["on_bye"] else (r["injury_status"] or "").lower()})
    return list(teams.values())


async def _started_pro_teams(season: int, week: int) -> set[str]:
    try:
        games = await get_week_scoreboard(week, season)
    except Exception:
        return set()
    now = datetime.now(timezone.utc)
    started = set()
    for game in games:
        try:
            kickoff = datetime.fromisoformat(game["date"].replace("Z", "+00:00"))
        except (KeyError, AttributeError, ValueError):
            continue
        if kickoff <= now:
            started.update(t for t in (game.get("home_team"), game.get("away_team")) if t)
    return started


# ---- The hub -------------------------------------------------------------


def _reception_label(value: float) -> str:
    if value == 1:
        return "PPR"
    if value == 0.5:
        return "Half PPR"
    if value == 0:
        return "Standard"
    return f"{value:g} per catch"


async def summary(conn, league_id: int, season: int) -> dict:
    league = await leagues_queries.get_league(conn, league_id)
    week = await league_queries.get_cached_current_week(conn, season)
    now = datetime.now(timezone.utc)

    members = await leagues_queries.list_members(conn, league_id)
    teams = await _teams_by_user(conn, league_id, season)
    active = await _last_active(conn, league_id)
    trade_settings = await trades_domain.get_trade_settings(conn, league_id, season)
    pending_trades = await conn.fetchval(
        "SELECT count(*) FROM trades WHERE league_id = $1 AND season = $2 AND status IN ('awaiting_review', 'in_review')",
        league_id, season,
    )
    keeper_rules = await keeper_queries.get_rules(conn, season, league_id)
    waivers = await get_waiver_settings(conn, league_id)
    problems = await lineup_problems(conn, league_id, season, week)
    playoffs = await league_queries.get_playoff_settings(conn, season, league_id)
    last_regular = await conn.fetchval(
        "SELECT MAX(week) FROM matchups WHERE season = $1 AND league_id = $2 AND is_playoff = FALSE", season, league_id
    )
    team_count = await conn.fetchval("SELECT count(*) FROM teams_by_season WHERE league_id = $1 AND season = $2", league_id, season)

    needs: list[dict] = []
    if pending_trades:
        needs.append({
            "kind": "trades", "tone": "orange",
            "title": f"{pending_trades} trade{'s' if pending_trades != 1 else ''} to review",
            "sub": "Approve or veto before they go through", "action": "Review", "href": "/commissioner/trades",
        })
    if problems:
        names = ", ".join(p["team_name"] for p in problems[:3])
        needs.append({
            "kind": "lineups", "tone": "red",
            "title": f"{len(problems)} team{'s' if len(problems) != 1 else ''} start{'s' if len(problems) == 1 else ''} someone who can't play",
            "sub": names, "action": "Fix", "href": "/commissioner/lineup",
        })
    no_team = [m for m in members if m["user_id"] not in teams]
    if no_team and team_count:
        needs.append({
            "kind": "members", "tone": "purple",
            "title": f"{len(no_team)} member{'s' if len(no_team) != 1 else ''} without a team",
            "sub": ", ".join(m["display_name"] or "Member" for m in no_team[:3]), "action": "Assign", "href": "/commissioner/members",
        })
    quiet = [
        m for m in members
        if m["user_id"] in teams and (m["user_id"] not in active or now - active[m["user_id"]] > INACTIVE_AFTER)
    ]
    if quiet:
        needs.append({
            "kind": "inactive", "tone": "orange",
            "title": f"{len(quiet)} member{'s' if len(quiet) != 1 else ''} haven't been around in 10+ days",
            "sub": ", ".join(m["display_name"] or "Member" for m in quiet[:3]), "action": "See", "href": "/commissioner/members",
        })
    # Filled in after each week by the scheduler's week flip
    # (app/domain/rivalry_detection.py), so this only counts.
    rivalries = await rivalry_detection.count_pending(conn, league_id)
    if rivalries:
        needs.append({
            "kind": "rivalries", "tone": "red",
            "title": f"{rivalries} suggested rivalr{'ies' if rivalries != 1 else 'y'} to review",
            "sub": "Your league's history says these two have beef", "action": "Review", "href": "/commissioner/rivalries",
        })
    deadline = trade_settings.get("trade_deadline")
    if deadline and now < deadline < now + SOON:
        needs.append({
            "kind": "deadline", "tone": "blue", "title": "Trade deadline is coming up",
            "sub": _iso(deadline), "action": "Change", "href": "/commissioner/calendar", "at": _iso(deadline),
        })
    if keeper_rules and keeper_rules["keeper_deadline"] and now < keeper_rules["keeper_deadline"] < now + SOON:
        needs.append({
            "kind": "deadline", "tone": "blue", "title": "Keeper deadline is coming up",
            "sub": _iso(keeper_rules["keeper_deadline"]), "action": "Change", "href": "/commissioner/calendar",
            "at": _iso(keeper_rules["keeper_deadline"]),
        })

    rules = {r["stat_category"]: float(r["points_per_unit"]) for r in await conn.fetch(
        "SELECT stat_category, points_per_unit FROM league_scoring_rules WHERE league_id = $1 AND season = $2 "
        "AND stat_category IN ('rec', 'pass_td')",
        league_id, season,
    )}
    slots = await conn.fetchval(
        "SELECT roster_slots FROM league_roster_slots_settings WHERE season = $1 AND league_id = $2", season, league_id
    )
    if isinstance(slots, str):
        slots = json.loads(slots)
    filter_words = await conn.fetchval("SELECT cardinality(words) FROM league_chat_filter_words WHERE league_id = $1", league_id)
    open_polls = await conn.fetchval("SELECT count(*) FROM league_polls WHERE league_id = $1 AND status = 'open'", league_id)
    wheel_items = await conn.fetchval(
        "SELECT count(*) FROM punishment_wheel_items WHERE league_id = $1 AND season = $2", league_id, season
    )
    espn = await conn.fetchrow("SELECT last_synced_at, last_sync_error FROM league_espn_connections WHERE league_id = $1", league_id)
    sleeper = await conn.fetchrow(
        "SELECT last_synced_at, last_sync_error FROM league_sleeper_connections WHERE league_id = $1", league_id
    )
    draft = await conn.fetchrow(
        "SELECT status, scheduled_start, completed_at FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
    )

    def roster_line() -> str:
        if not slots:
            return "Not set"
        starters = [f"{n} {k}" if n > 1 else k for k, n in slots.items() if k not in ("BE", "IR", "TAXI") and n]
        bench = slots.get("BE", 0)
        line = ", ".join(starters) + (f" · {bench} bench" if bench else "")
        if keeper_rules and league["league_type"] in ("keeper", "dynasty"):
            line += f" · {keeper_rules['max_keepers']} keepers"
        return line

    commissioners = sum(1 for m in members if m["role"] == "commissioner")
    start_week = playoffs["start_week"] or ((last_regular or 14) + 1)
    return {
        "league": {
            "id": league_id,
            "name": league["name"],
            "invite_code": league["invite_code"],
            "league_type": league["league_type"],
            "matchup_type": league["matchup_type"],
            "commish_log_public": league.get("commish_log_public", True),
        },
        "needs_you": needs,
        "glance": {
            "teams": team_count,
            "matchups": "Head to head" if league["matchup_type"] == "h2h" else "Total points",
            "scoring": _reception_label(rules.get("rec", 0)),
            "week": week,
            "last_regular_week": last_regular,
            "playoff_teams": playoffs["playoff_team_count"],
            "playoff_start_week": start_week,
        },
        "tools": {
            "league": f"{league['name']} · {team_count} teams",
            "scoring": f"{_reception_label(rules.get('rec', 0))} · {rules.get('pass_td', 4):g}-pt passing TDs",
            "roster": roster_line(),
            "waivers": waiver_summary(waivers),
            "members": f"{len(members)} members · {commissioners} commissioner{'s' if commissioners != 1 else ''}",
            "calendar": f"Trade deadline {deadline.date().isoformat()}" if deadline else "Set your league's dates",
            "trades": f"{pending_trades} waiting for review" if pending_trades else "Nothing waiting",
            "lineup": f"{len(problems)} team{'s' if len(problems) != 1 else ''} to check" if problems else "Move, add or drop for any team",
            "draft": (
                "Done" if draft and draft["status"] == "complete"
                else f"Set for {draft['scheduled_start'].date().isoformat()}" if draft and draft["scheduled_start"]
                else "Not set up yet"
            ),
            "polls": f"{open_polls} open poll{'s' if open_polls != 1 else ''}" if open_polls else "No open polls",
            "rivalries": f"{rivalries} suggested to review" if rivalries else "Suggested from your league's history",
            "chat_filter": f"{filter_words} extra word{'s' if filter_words != 1 else ''} hidden" if filter_words else "Only the built-in list",
            "wheel": f"{wheel_items} punishment{'s' if wheel_items != 1 else ''} loaded" if wheel_items else "Empty",
            "espn": (
                ("ESPN · sync problem" if espn["last_sync_error"] else "ESPN connected") if espn
                else ("Sleeper · sync problem" if sleeper["last_sync_error"] else "Sleeper connected") if sleeper
                else "ESPN or Sleeper"
            ),
            "corner": "Post an announcement to everyone",
        },
    }


# ---- Members -----------------------------------------------------------


async def members(conn, league_id: int, season: int) -> list[dict]:
    rows = await leagues_queries.list_members(conn, league_id)
    teams = await _teams_by_user(conn, league_id, season)
    active = await _last_active(conn, league_id)
    out = []
    for m in rows:
        out.append({
            "user_id": m["user_id"],
            "display_name": m["display_name"] or "Member",
            # The photo they chose in Settings (owners.logo_url), if any.
            "photo_url": m["logo_url"],
            "role": m["role"],
            "joined_at": _iso(m["joined_at"]),
            "last_active_at": _iso(active.get(m["user_id"])),
            "team": teams.get(m["user_id"]),
        })
    return out


# ---- Calendar ------------------------------------------------------------


async def calendar(conn, league_id: int, season: int) -> dict:
    now = datetime.now(timezone.utc)
    kickoffs = await week_kickoffs(season)
    keeper_rules = await keeper_queries.get_rules(conn, season, league_id)
    next_keepers = await keeper_queries.get_rules(conn, season + 1, league_id)
    trade_settings = await trades_domain.get_trade_settings(conn, league_id, season)
    waivers = await get_waiver_settings(conn, league_id)
    playoffs = await league_queries.get_playoff_settings(conn, season, league_id)
    league = await leagues_queries.get_league(conn, league_id)
    last_regular = await conn.fetchval(
        "SELECT MAX(week) FROM matchups WHERE season = $1 AND league_id = $2 AND is_playoff = FALSE", season, league_id
    )
    draft = await conn.fetchrow(
        "SELECT status, scheduled_start, started_at, completed_at FROM draft_config WHERE season = $1 AND league_id = $2",
        season, league_id,
    )
    draft_at = (draft["completed_at"] or draft["started_at"] or draft["scheduled_start"]) if draft else None
    if draft_at is None:
        draft_at = await conn.fetchval(
            "SELECT scheduled_start FROM league_draft_schedule WHERE season = $1 AND league_id = $2", season, league_id
        )
    start_week = playoffs["start_week"] or ((last_regular or 14) + 1)
    teams = max(2, playoffs["playoff_team_count"] or 4)
    rounds = math.ceil(math.log2(teams))
    final_week = start_week + rounds * (playoffs["weeks_per_matchup"] or 1) - 1

    def week_at(week: int | None) -> str | None:
        return _iso(kickoffs.get(week)) if week else None

    keepers_on = league["league_type"] in ("keeper", "dynasty")
    items = [
        {"key": "keeper_deadline", "title": "Keeper deadline", "at": _iso(keeper_rules["keeper_deadline"]) if keeper_rules else None,
         "editable": keepers_on, "shown": keepers_on},
        {"key": "draft", "title": "Draft", "at": _iso(draft_at), "editable": False, "shown": True,
         "done": bool(draft and draft["status"] == "complete")},
        {"key": "waivers", "title": "Waivers run", "at": _iso(next_clear(now, waivers)), "editable": True, "shown": True,
         "repeats": f"Every {WEEKDAYS[waivers['clear_weekday']]} · {hour_label(waivers['clear_hour'])} ET"},
        {"key": "trade_deadline", "title": "Trade deadline", "at": _iso(trade_settings.get("trade_deadline")),
         "editable": True, "shown": True},
        {"key": "regular_season_end", "title": "Last regular-season week", "week": last_regular,
         "at": week_at(last_regular), "editable": False, "shown": last_regular is not None},
        {"key": "playoffs_start", "title": "Playoffs start", "week": start_week, "at": week_at(start_week),
         "detail": f"{playoffs['playoff_team_count']} teams", "editable": True, "shown": True},
        {"key": "championship", "title": "Championship", "week": final_week, "at": week_at(final_week),
         "editable": False, "shown": final_week <= LAST_NFL_WEEK},
        {"key": "next_keeper_deadline", "title": f"{season + 1} keeper deadline",
         "at": _iso(next_keepers["keeper_deadline"]) if next_keepers else None, "editable": False, "shown": keepers_on},
    ]
    for item in items:
        at = item.get("at")
        item["past"] = bool(at and datetime.fromisoformat(at) < now and item["key"] != "waivers")
        if item["key"] == "draft" and item.get("done"):
            item["past"] = True
    return {
        "season": season,
        "items": [i for i in items if i.pop("shown")],
        "week_kickoffs": {str(w): _iso(k) for w, k in sorted(kickoffs.items())},
        "waivers": waivers,
        "playoffs": {**playoffs, "effective_start_week": start_week},
    }


# ---- Trade review --------------------------------------------------------


async def trade_review(conn, league_id: int, season: int) -> dict:
    pending = await trades_domain.list_pending_review(conn, league_id, season)
    settings = await trades_domain.get_trade_settings(conn, league_id, season)
    week = await league_queries.get_cached_current_week(conn, season) or 1
    player_ids = sorted({a["sleeper_player_id"] for t in pending for a in t["assets"]})
    projections = {}
    if player_ids:
        rows = await conn.fetch(
            """
            SELECT p.sleeper_player_id, COALESCE(SUM(w.projected_points), 0) AS ros, pl.pro_team, pl.injury_status
            FROM unnest($3::text[]) AS p(sleeper_player_id)
            JOIN players pl ON pl.sleeper_player_id = p.sleeper_player_id
            LEFT JOIN player_weekly_projections w
                ON w.sleeper_player_id = p.sleeper_player_id AND w.season = $1 AND w.week >= $2 AND w.week <= 17
            GROUP BY p.sleeper_player_id, pl.pro_team, pl.injury_status
            """,
            season, week, player_ids,
        )
        projections = {r["sleeper_player_id"]: r for r in rows}
    votes = {
        r["trade_id"]: r["n"]
        for r in await conn.fetch(
            "SELECT trade_id, count(*) AS n FROM trade_veto_votes WHERE trade_id = ANY($1::int[]) GROUP BY trade_id",
            [t["id"] for t in pending],
        )
    }
    out = []
    for t in pending:
        sides = []
        for team_id, name in ((t["proposing_team_id"], t.get("proposing_team_name")), (t["receiving_team_id"], t.get("receiving_team_name"))):
            gets = []
            for a in t["assets"]:
                if a["to_team_id"] != team_id:
                    continue
                p = projections.get(a["sleeper_player_id"])
                gets.append({
                    "sleeper_player_id": a["sleeper_player_id"],
                    "name": a["player_name"],
                    "position": a["position"],
                    "pro_team": p["pro_team"] if p else None,
                    "injury_status": p["injury_status"] if p else None,
                    "ros_points": round(float(p["ros"]), 1) if p else 0.0,
                })
            sides.append({"team_id": team_id, "team_name": name, "gets": gets, "ros_points": round(sum(g["ros_points"] for g in gets), 1)})
        out.append({
            "id": t["id"],
            "status": t["status"],
            "accepted_at": _iso(t.get("accepted_at")),
            "review_ends_at": _iso(t.get("review_ends_at")),
            "note": t.get("note"),
            "veto_votes": votes.get(t["id"], 0),
            "sides": sides,
        })
    return {"trades": out, "settings": settings, "from_week": week}
