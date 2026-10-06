"""
Keeping the Lounge's rooms honest (2026-10):

- A TV clears itself once its game is over. "Final" is noticed the first
  time the scoreboard says so, and the TV is cleared TV_CLEAR_AFTER
  later — a room watches on a delay of up to three minutes, so the
  stream gets to finish before the game leaves the screen. Then the
  League Lounge stops saying a finished game is on.
- An open watch party (kind 'party') closes itself once nobody's in it
  and either its game is over or it's sat idle for PARTY_IDLE. The
  League Lounge itself never closes.

Run from GET /watch-party/rooms (so the lobby is always right when it's
opened) and from a scheduler tick (so rooms nobody looks at still get
tidied). Returns what changed so the caller can tell anyone in a room.
"""
import time
from datetime import datetime, timedelta, timezone

from app.providers.nfl_scoreboard import get_nfl_scoreboard
from app.queries import watch_party as watch_party_queries

TV_CLEAR_AFTER = 600  # seconds after the game is first seen final
PARTY_IDLE = timedelta(hours=2)
PARTY_EMPTY_GRACE = timedelta(minutes=20)
# Final, and kicked off this long ago: over for sure.
LONG_OVER = timedelta(hours=5)

# game_id -> when it was first seen final (process memory: a restart
# only delays a clear by TV_CLEAR_AFTER).
_final_seen: dict[str, float] = {}


async def sweep_rooms(conn, live_room_ids: set[int], league_id: int | None = None) -> dict:
    rooms = await conn.fetch(
        "SELECT * FROM watch_party_rooms WHERE closed_at IS NULL"
        + (" AND league_id = $1" if league_id is not None else ""),
        *([league_id] if league_id is not None else []),
    )
    if not rooms:
        return {"cleared": [], "closed": []}
    states: dict[str, str] = {}
    kickoffs: dict[str, datetime] = {}
    if any(r["tv_game_id"] for r in rooms):
        try:
            for g in await get_nfl_scoreboard():
                states[str(g.get("id"))] = g.get("state")
                try:
                    kickoffs[str(g.get("id"))] = datetime.fromisoformat(str(g.get("date")).replace("Z", "+00:00"))
                except ValueError:
                    pass
        except Exception:
            states = {}
    now = time.time()
    utc_now = datetime.now(timezone.utc)
    for game_id, state in states.items():
        if state == "post":
            # A final that kicked off hours ago (seen for the first time
            # after a restart) has been over a long while already.
            long_over = game_id in kickoffs and utc_now - kickoffs[game_id] > LONG_OVER
            _final_seen.setdefault(game_id, now - TV_CLEAR_AFTER if long_over else now)
        else:
            _final_seen.pop(game_id, None)

    cleared, closed = [], []
    for r in rooms:
        game = r["tv_game_id"]
        # Over: final for a while — or gone from this week's scoreboard
        # altogether (last week's game, still on the TV).
        game_over = bool(game) and (
            (game in _final_seen and now - _final_seen[game] >= TV_CLEAR_AFTER) or (bool(states) and game not in states)
        )
        if game_over:
            await watch_party_queries.clear_room_tv(conn, r["id"])
            cleared.append(r["id"])
        if r["kind"] != "party" or r["id"] in live_room_ids:
            continue
        idle = utc_now - r["last_active_at"]
        tv_done = not game or game_over or states.get(game) == "post"
        if (tv_done and idle >= PARTY_EMPTY_GRACE) or idle >= PARTY_IDLE:
            await watch_party_queries.close_room(conn, r["id"])
            closed.append(r["id"])
    return {"cleared": cleared, "closed": closed}
