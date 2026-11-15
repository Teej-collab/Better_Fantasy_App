"""
Live league events for paired TVs (The Weekend TV, 2026-11-14).

A TV holds one Server-Sent Events stream open (GET /tv/live, app/routers/
tv.py). The live sync job (app/scheduler.py) already snapshots the week
before and after each tick to send touchdown pushes; it hands the same
two snapshots here, and every TV whose league changed hears about it the
moment the new points land instead of on its next poll:

  {"type": "scores"}                       refetch, something moved
  {"type": "touchdown", "player_name", "team_name", "points_delta", ...}
  {"type": "inactive", "player_name", "team_name", "kickoff"}   (app/notifications/inactives.py)

A second channel is per account rather than per league: the phone's
"Send to TV" and remote (POST /tv/send) reach every TV that account has
paired, on the stream the TV's remote service holds (GET /tv/remote).

In-process, one queue per open stream — the same "one backend instance,
no Redis" reasoning as app/gamecast/manager.py. Nothing here ever calls a
third-party feed: it only fans out what the existing sync already did.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)

_BENCH_SLOTS = {"BE", "IR", "TAXI"}
_QUEUE_SIZE = 50

# league_id -> the open streams' queues
_subscribers: dict[int, set[asyncio.Queue]] = {}
# user_id -> the account's TVs' remote streams
_remotes: dict[int, set[asyncio.Queue]] = {}


def subscribe(league_id: int) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=_QUEUE_SIZE)
    _subscribers.setdefault(league_id, set()).add(q)
    return q


def unsubscribe(league_id: int, q: asyncio.Queue) -> None:
    subs = _subscribers.get(league_id)
    if not subs:
        return
    subs.discard(q)
    if not subs:
        del _subscribers[league_id]


def subscribe_remote(user_id: int) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=_QUEUE_SIZE)
    _remotes.setdefault(user_id, set()).add(q)
    return q


def unsubscribe_remote(user_id: int, q: asyncio.Queue) -> None:
    subs = _remotes.get(user_id)
    if subs:
        subs.discard(q)
        if not subs:
            del _remotes[user_id]


def send_to_account(user_id: int, event: dict) -> int:
    """Hands an event to every TV this account has listening; returns how many."""
    subs = list(_remotes.get(user_id, ()))
    for q in subs:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass
    return len(subs)


def send_inactive(league_id: int, player_name: str, team_name: str, kickoff: str) -> None:
    """A starter named inactive (app/notifications/inactives.py): the TV warns in time to swap him."""
    _send(league_id, {"type": "inactive", "player_name": player_name, "team_name": team_name, "kickoff": kickoff})


def connection_count() -> int:
    return sum(len(s) for s in _subscribers.values())


def _send(league_id: int, event: dict) -> None:
    for q in list(_subscribers.get(league_id, ())):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass  # a stalled TV misses this one; it refetches on the next "scores"


def changed_leagues(before: dict, after: dict) -> set[int]:
    """Leagues where any player's points or any matchup score moved."""
    leagues = set()
    b_pts, a_pts = before.get("player_points", {}), after.get("player_points", {})
    for key, pts in a_pts.items():
        if b_pts.get(key) != pts:
            leagues.add(key[0])
    b_m = before.get("matchups", {})
    for mid, m in after.get("matchups", {}).items():
        old = b_m.get(mid)
        if old is None or old["home_score"] != m["home_score"] or old["away_score"] != m["away_score"]:
            if m.get("league_id") is not None:
                leagues.add(m["league_id"])
    return leagues


async def publish(conn, season: int, before: dict, after: dict) -> None:
    """Called by the live sync after each tick. Cheap when nobody's watching."""
    if not _subscribers:
        return
    try:
        watched = set(_subscribers)
        for league_id in changed_leagues(before, after) & watched:
            _send(league_id, {"type": "scores"})
        await _publish_touchdowns(conn, season, before, after, watched)
    except Exception:
        logger.exception("TV live publish failed (season=%s)", season)


async def _publish_touchdowns(conn, season: int, before: dict, after: dict, watched: set[int]) -> None:
    before_tds, after_tds = before.get("player_tds", {}), after.get("player_tds", {})
    scorers = [pid for pid, tds in after_tds.items() if tds > before_tds.get(pid, 0)]
    if not scorers:
        return
    rows = await conn.fetch(
        """
        SELECT cr.sleeper_player_id, cr.lineup_slot, t.league_id, t.team_name,
               p.full_name AS player_name, p.position, p.pro_team
        FROM current_rosters cr
        JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
        JOIN teams_by_season t ON t.id = cr.team_id
        WHERE cr.season = $1 AND cr.sleeper_player_id = ANY($2::text[]) AND t.league_id = ANY($3::int[])
        """,
        season, scorers, list(watched),
    )
    for r in rows:
        if r["lineup_slot"] in _BENCH_SLOTS:
            continue  # a benched touchdown is a sad story, not a banner
        key = (r["league_id"], r["sleeper_player_id"])
        delta = None
        if key in after.get("player_points", {}):
            delta = round(after["player_points"][key] - before.get("player_points", {}).get(key, 0.0), 2)
        _send(r["league_id"], {
            "type": "touchdown",
            "player_name": r["player_name"],
            "position": r["position"],
            "pro_team": r["pro_team"],
            "team_name": r["team_name"],
            "points_delta": delta,
        })
