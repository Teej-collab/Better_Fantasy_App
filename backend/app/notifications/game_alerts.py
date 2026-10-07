"""
The four pushes every fantasy app has (2026-10, closing the gap with
ESPN and Sleeper):

- notify_waiver_results — after each waiver run, one push per team:
  what it won (bid, drop) and why claims failed.
- notify_matchup_finals — when the week settles: "You beat X 121.4–98.0 · now 5–1".
- check_pregame_lineups — 45–100 minutes before a starter's game, if he's
  listed Out/Doubtful/IR/Suspended (inactives come out ~90 minutes
  before kickoff): "Puka Nacua is Out — he's in your lineup".
- check_close_games — once a matchup comes down to its last game window
  and is still in reach: "You need 8.4 — it comes down to Kelce".

Each is sent once per thing it's about (notification_once), so a retried
job or a restart never repeats one. They follow the owner's push
preferences: injuries for the pre-kickoff alert, "my fantasy team" for
the rest.
"""
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.domain.matchup_context import build_week_matchup_context
from app.notifications import dispatcher, formatter
from app.queries import owner_preferences as preferences_queries

logger = logging.getLogger(__name__)

BENCHED = {"BE", "IR", "TAXI"}
OUT_STATUSES = {"Out": "OUT", "Doubtful": "doubtful", "IR": "on IR", "Suspended": "suspended", "PUP": "on PUP", "NFI": "on NFI", "Inactive": "INACTIVE"}
PREGAME_WINDOW = (timedelta(minutes=45), timedelta(minutes=100))
# A close game: the margin is within what's left to play, plus this cushion.
CLOSE_CUSHION = 10.0
EASTERN = ZoneInfo("America/New_York")


async def claim_once(conn, key: str) -> bool:
    row = await conn.fetchrow(
        "INSERT INTO notification_once (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key", key
    )
    return row is not None


async def _send(conn, owner_id: int | None, payload: dict, category: str) -> None:
    if owner_id is None:
        return
    prefs = await preferences_queries.get_preferences(conn, owner_id)
    if prefs["push_enabled"] and prefs.get(category, True):
        await dispatcher.send_to_owner(conn, owner_id, payload)


# ---- Waivers ----------------------------------------------------------------

async def notify_waiver_results(conn, season: int, league_id: int, results: list[dict]) -> int:
    claim_ids = [o["claim_id"] for r in results for o in r.get("outcomes", [])]
    if not claim_ids:
        return 0
    rows = await conn.fetch(
        """
        SELECT wc.id, wc.team_id, wc.status, wc.failure_reason, wc.bid_amount,
               t.owner_id, pa.full_name AS player, pd.full_name AS dropped
        FROM waiver_claims wc
        JOIN teams_by_season t ON t.id = wc.team_id
        JOIN players pa ON pa.sleeper_player_id = wc.add_sleeper_player_id
        LEFT JOIN players pd ON pd.sleeper_player_id = wc.drop_sleeper_player_id
        WHERE wc.id = ANY($1::int[])
        """,
        claim_ids,
    )
    by_team: dict[int, dict] = {}
    for r in rows:
        team = by_team.setdefault(r["team_id"], {"owner_id": r["owner_id"], "won": [], "failed": [], "ids": []})
        team["ids"].append(r["id"])
        if r["status"] == "successful":
            team["won"].append({"player": r["player"], "dropped": r["dropped"], "bid": r["bid_amount"]})
        else:
            team["failed"].append({"player": r["player"], "reason": r["failure_reason"] or "The claim didn't go through."})
    sent = 0
    for team_id, team in by_team.items():
        if not await claim_once(conn, f"waivers-{league_id}-{season}-{team_id}-{min(team['ids'])}"):
            continue
        await _send(conn, team["owner_id"], formatter.waiver_results(team["won"], team["failed"]), "notify_fantasy_team")
        sent += 1
    return sent


# ---- Matchup finals ---------------------------------------------------------

async def notify_matchup_finals(conn, season: int, week: int, league_id: int) -> int:
    if not await claim_once(conn, f"finals-{league_id}-{season}-{week}"):
        return 0
    context = await build_week_matchup_context(conn, season, week, league_id)
    sent = 0
    for m in context["matchups"]:
        home, away = m["home"], m["away"]
        if home["score"] is None or away["score"] is None:
            continue
        for me, them in ((home, away), (away, home)):
            result = "win" if me["score"] > them["score"] else "loss" if me["score"] < them["score"] else "tie"
            await _send(
                conn, me["owner_id"],
                formatter.matchup_final(result, them["team_name"], me["score"], them["score"], me["record"], m["matchup_id"]),
                "notify_fantasy_team",
            )
            sent += 1
    return sent


# ---- Pre-kickoff: a starter who won't play ---------------------------------

def _kickoff_label(iso: str) -> str:
    t = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(EASTERN)
    return t.strftime("%-I:%M %p ET")


def _parse(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None


async def check_pregame_lineups(conn, season: int, week: int, league_id: int, now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    context = await build_week_matchup_context(conn, season, week, league_id)
    sent = 0
    for m in context["matchups"]:
        for side in (m["home"], m["away"]):
            for p in side["roster"]:
                if p["lineup_slot"] in BENCHED or p.get("game_status") != "scheduled":
                    continue
                status = OUT_STATUSES.get(p.get("injury_status") or "")
                kickoff = _parse(p.get("game_time"))
                if not status or kickoff is None:
                    continue
                if not (PREGAME_WINDOW[0] <= kickoff - now <= PREGAME_WINDOW[1]):
                    continue
                key = f"pregame-{league_id}-{season}-{week}-{side['team_id']}-{p['player_id']}"
                if not await claim_once(conn, key):
                    continue
                await _send(
                    conn, side["owner_id"],
                    formatter.pregame_starter_out(p["player_name"], status, _kickoff_label(p["game_time"]), m["matchup_id"], key),
                    "notify_injuries",
                )
                sent += 1
    return sent


# ---- Close games ------------------------------------------------------------

def _remaining(side: dict) -> list[dict]:
    return [
        p for p in side["roster"]
        if p["lineup_slot"] not in BENCHED and p.get("game_status") in ("scheduled", "in_progress")
    ]


def _left_to_score(players: list[dict]) -> float:
    total = 0.0
    for p in players:
        projected = p.get("live_projected") if p.get("live_projected") is not None else p.get("points_projected")
        total += max(0.0, (projected or 0.0) - (p.get("points_scored") or 0.0))
    return total


def _names(players: list[dict]) -> str:
    names = [f"{p['player_name']} ({(p.get('live_projected') or p.get('points_projected') or 0):.1f} proj)" for p in players[:2]]
    if len(players) > 2:
        names.append(f"{len(players) - 2} more")
    return " and ".join(names) if len(names) < 3 else ", ".join(names[:-1]) + f" and {names[-1]}"


async def check_close_games(conn, season: int, week: int, league_id: int, now: datetime | None = None) -> int:
    """Once per matchup: when everything left to play kicks off in one
    window (Sunday night, Monday night…) that's within the hour or
    underway, and the margin is still in reach."""
    now = now or datetime.now(timezone.utc)
    context = await build_week_matchup_context(conn, season, week, league_id)
    sent = 0
    for m in context["matchups"]:
        home, away = m["home"], m["away"]
        if home["score"] is None or away["score"] is None:
            continue
        left = {"home": _remaining(home), "away": _remaining(away)}
        everyone = left["home"] + left["away"]
        if not everyone:
            continue
        kickoffs = {_parse(p.get("game_time")) for p in everyone}
        if None in kickoffs or len(kickoffs) != 1:
            continue  # more than one window still to come
        kickoff = next(iter(kickoffs))
        if kickoff - now > timedelta(hours=1):
            continue
        margin = home["score"] - away["score"]
        reach = _left_to_score(left["home"] if margin < 0 else left["away"]) + CLOSE_CUSHION
        if abs(margin) > reach:
            continue
        if not await claim_once(conn, f"close-{league_id}-{season}-{week}-{m['matchup_id']}"):
            continue
        for me, them, mine, theirs in ((home, away, left["home"], left["away"]), (away, home, left["away"], left["home"])):
            diff = me["score"] - them["score"]
            if diff < 0:
                title = f"🔥 Close one: you're down {abs(diff):.1f}"
                body = f"It comes down to {_names(mine)}." if mine else f"Nobody left to play — {them['team_name']} has {_names(theirs)}."
            elif diff > 0:
                title = f"😬 Hang on: you're up {diff:.1f}"
                body = f"{them['team_name']} still has {_names(theirs)}." if theirs else f"You have {_names(mine)} left."
            else:
                title = "🔥 Dead even"
                body = f"Tied with {them['team_name']} — {_names(everyone)} decide it."
            await _send(conn, me["owner_id"], formatter.close_game(title, body, m["matchup_id"]), "notify_fantasy_team")
            sent += 1
    return sent
