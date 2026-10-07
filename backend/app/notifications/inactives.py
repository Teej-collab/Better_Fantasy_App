"""
Game-day inactives (2026-10), like ESPN's: NFL teams name their
inactive players about 90 minutes before kickoff, and anyone who has one
of them in their starting lineup gets "🚫 Puka Nacua is INACTIVE".

Source: ESPN's public per-game rosters (sports.core.api.espn.com
…/competitors/{team}/roster), where inactive players come back with
didNotPlay = true. Checked from 100 minutes before each kickoff until 10
minutes after it, every game_alerts tick (app/scheduler.py); a game
stops being polled once both teams' lists are in. Before kickoff nobody
has played yet, so didNotPlay there means inactive (after the game it
also covers active players who never got in, which is why this never
looks at a game that's underway).

Each player alerts once per team per week (notification_once), and not
at all when the pre-kickoff "listed Out" alert already went out for him
(app/notifications/game_alerts.py).
"""
import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.notifications import dispatcher, formatter
from app.notifications.game_alerts import BENCHED, _kickoff_label, claim_once
from app.queries import owner_preferences as preferences_queries

logger = logging.getLogger(__name__)

CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/{event}/competitions/{event}"
WINDOW_BEFORE = timedelta(minutes=100)
WINDOW_AFTER = timedelta(minutes=10)
# A team's real inactive list is several players; fewer usually means
# ESPN hasn't posted it yet, so keep polling that game.
FULL_LIST = 3

_done_games: set[str] = set()


def _reset_for_tests() -> None:
    _done_games.clear()


def _start(game: dict) -> datetime | None:
    try:
        return datetime.fromisoformat((game.get("date") or "").replace("Z", "+00:00"))
    except ValueError:
        return None


def games_in_window(games: list[dict], now: datetime) -> list[dict]:
    out = []
    for g in games:
        start = _start(g)
        if start is None or str(g.get("id")) in _done_games:
            continue
        if g.get("state") in ("pre", "in") and -WINDOW_AFTER <= start - now <= WINDOW_BEFORE:
            out.append(g)
    return out


async def fetch_inactive_espn_ids(client: httpx.AsyncClient, event_id: str) -> tuple[list[int], int]:
    """(ESPN athlete ids marked inactive, how many teams had a full list)."""
    competitors = (await client.get(f"{CORE.format(event=event_id)}/competitors")).json()
    inactive: list[int] = []
    full_teams = 0
    for item in competitors.get("items", []):
        ref = (item.get("$ref") or "").split("?")[0]
        if not ref:
            continue
        roster = (await client.get(f"{ref}/roster")).json()
        team_inactive = [int(e["playerId"]) for e in roster.get("entries", []) if e.get("didNotPlay") is True and e.get("playerId")]
        if len(team_inactive) >= FULL_LIST:
            full_teams += 1
        inactive += team_inactive
    return inactive, full_teams


async def notify_inactive_starters(conn, season: int, week: int, espn_ids: list[int], kickoff: str) -> int:
    if not espn_ids:
        return 0
    rows = await conn.fetch(
        """
        SELECT cr.team_id, cr.lineup_slot, t.owner_id, t.league_id, p.full_name, p.sleeper_player_id
        FROM players p
        JOIN current_rosters cr ON cr.sleeper_player_id = p.sleeper_player_id AND cr.season = $1
        JOIN teams_by_season t ON t.id = cr.team_id
        WHERE p.espn_player_id = ANY($2::bigint[])
        """,
        season, espn_ids,
    )
    sent = 0
    for r in rows:
        if r["lineup_slot"] in BENCHED or r["owner_id"] is None:
            continue
        pregame_key = f"pregame-{r['league_id']}-{season}-{week}-{r['team_id']}-{r['sleeper_player_id']}"
        if await conn.fetchval("SELECT 1 FROM notification_once WHERE key = $1", pregame_key):
            continue  # already told "he's listed Out"
        key = f"inactive-{r['league_id']}-{season}-{week}-{r['team_id']}-{r['sleeper_player_id']}"
        if not await claim_once(conn, key):
            continue
        prefs = await preferences_queries.get_preferences(conn, r["owner_id"])
        if prefs["push_enabled"] and prefs.get("notify_injuries", True):
            await dispatcher.send_to_owner(conn, r["owner_id"], formatter.inactive_starter(r["full_name"], kickoff, key))
            sent += 1
    return sent


async def check_inactives(pool, season: int, week: int, games: list[dict], now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    window = games_in_window(games, now)
    if not window:
        return 0
    sent = 0
    async with httpx.AsyncClient(timeout=10) as client:
        for g in window:
            event_id = str(g.get("id"))
            try:
                espn_ids, full_teams = await fetch_inactive_espn_ids(client, event_id)
            except Exception:
                logger.warning("Inactives fetch failed for event %s", event_id, exc_info=True)
                continue
            # Kept at INFO on purpose: the first live games confirm when
            # ESPN posts the lists (2026-10).
            logger.info(
                "Inactives check event=%s (%s @ %s) kickoff_in=%s inactive=%d full_teams=%d",
                event_id, g.get("away_team"), g.get("home_team"), _start(g) - now, len(espn_ids), full_teams,
            )
            if g.get("state") != "pre" and _start(g) - now < timedelta(0) and full_teams < 2:
                # Kicked off without full lists — don't trust what comes after.
                _done_games.add(event_id)
                continue
            async with pool.acquire() as conn:
                sent += await notify_inactive_starters(conn, season, week, espn_ids, _kickoff_label(g["date"]))
            if full_teams >= 2:
                _done_games.add(event_id)
    return sent
