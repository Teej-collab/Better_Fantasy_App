"""
Injury alerts and player news for the players on an owner's roster
(every slot — starters, bench, and IR). Three kinds, all gated on
push_enabled plus their own preference:

- Status changes (notify_injuries): ESPN's league-wide injuries feed
  (one free call, all 32 teams) lists every player's designation —
  Active, Questionable, Doubtful, Out, Injured Reserve. run_injury_watch
  diffs it against player_injury_status, the last status seen for each
  player, every couple of hours (app/scheduler.py): a new injury, an
  upgrade (Out -> Questionable), a downgrade (Questionable -> Out), or
  being cleared (anything -> Active) each push once.
- Player news (notify_player_news): a new blurb in that same feed with
  no status change ("full practice Friday, expected to play"). On by
  default; owners who find it noisy turn it off.
- In-game injuries (notify_injuries): live_injury_status (app/domain/
  live_injuries.py) already tracks "left the game", "questionable/
  doubtful to return", "ruled out", and "returned" for live
  projections; notify_in_game_injuries pushes each new state once,
  using live_injury_status.notified_state as the marker.

The very first watch run (empty player_injury_status) only records the
feed, so turning this on doesn't push every existing injury at once.
A player seen for the first time later (a new injury, or a player newly
matched to an ESPN id) only pushes if the blurb is recent.

Quiet hours hold status changes and news until morning, and drop
in-game injuries (app/notifications/quiet_hours.py). Like every other
notification call site, nothing here may break the job that calls it.
"""
import datetime
import logging
import re

from app.notifications import dispatcher, formatter
from app.queries import owner_preferences as preferences_queries

logger = logging.getLogger(__name__)

# How bad each designation is, for telling an upgrade from a downgrade.
# Anything ESPN adds that isn't here (a suspension, PUP) ranks as Out.
_SEVERITY = {"Active": 0, "Questionable": 1, "Doubtful": 2, "Out": 3, "Injured Reserve": 4}
_UNKNOWN_SEVERITY = 3
# A player's first appearance in the feed only pushes if its blurb is
# this fresh — anything older is news the owner has already had.
_FIRST_SEEN_MAX_AGE = datetime.timedelta(hours=24)
_NEVER = datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)


def _parse_time(value: str | None) -> datetime.datetime | None:
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _espn_id(athlete: dict) -> int | None:
    if athlete.get("id"):
        return int(athlete["id"])
    for link in athlete.get("links", []):
        m = re.search(r"/id/(\d+)", link.get("href", ""))
        if m:
            return int(m.group(1))
    return None


def parse_injury_feed(feed: dict) -> list[dict]:
    """[{espn_player_id, status, injury, news_id, news_at, detail}], one
    per player (the newest entry if ESPN lists a player twice)."""
    by_player: dict[int, dict] = {}
    for team in feed.get("injuries", []):
        for entry in team.get("injuries", []):
            espn_id = _espn_id(entry.get("athlete") or {})
            status = entry.get("status")
            if espn_id is None or not status:
                continue
            item = {
                "espn_player_id": espn_id,
                "status": status,
                "injury": (entry.get("details") or {}).get("type"),
                "news_id": str(entry["id"]) if entry.get("id") else None,
                "news_at": _parse_time(entry.get("date")),
                "detail": entry.get("shortComment"),
            }
            existing = by_player.get(espn_id)
            if existing is None or (item["news_at"] or _NEVER) > (existing["news_at"] or _NEVER):
                by_player[espn_id] = item
    return list(by_player.values())


def classify(previous: dict | None, current: dict, now: datetime.datetime) -> tuple[str, str] | None:
    """What an owner should hear about this feed entry, as
    (kind, direction) — kind "injury" with direction new/upgrade/
    downgrade/cleared, or kind "news" (direction "") — or None."""
    if previous is None:
        fresh = current["news_at"] is not None and now - current["news_at"] <= _FIRST_SEEN_MAX_AGE
        if not fresh:
            return None
        if current["status"] == "Active":
            return ("news", "") if current["detail"] else None
        return ("injury", "new")
    if previous["status"] != current["status"]:
        if current["status"] == "Active":
            return ("injury", "cleared")
        before = _SEVERITY.get(previous["status"], _UNKNOWN_SEVERITY)
        after = _SEVERITY.get(current["status"], _UNKNOWN_SEVERITY)
        if previous["status"] == "Active" or after == before:
            return ("injury", "new")
        return ("injury", "downgrade" if after > before else "upgrade")
    newer = (
        current["news_id"] != previous["news_id"]
        and current["news_at"] is not None
        and (previous["news_at"] is None or current["news_at"] > previous["news_at"])
    )
    if newer and current["detail"]:
        return ("news", "")
    return None


async def _roster_owners(conn, season: int, sleeper_ids: list[str]) -> dict[str, list[dict]]:
    """sleeper_player_id -> [{owner_id, team_id, player_name}], one per
    owner even if they roster the player in more than one league."""
    if not sleeper_ids:
        return {}
    rows = await conn.fetch(
        """
        SELECT DISTINCT ON (cr.sleeper_player_id, t.owner_id)
               cr.sleeper_player_id, t.owner_id, cr.team_id, p.full_name AS player_name
        FROM current_rosters cr
        JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
        JOIN teams_by_season t ON t.id = cr.team_id
        WHERE cr.season = $1 AND cr.sleeper_player_id = ANY($2::text[]) AND t.owner_id IS NOT NULL
        ORDER BY cr.sleeper_player_id, t.owner_id, cr.team_id
        """,
        season, sleeper_ids,
    )
    owners: dict[str, list[dict]] = {}
    for r in rows:
        owners.setdefault(r["sleeper_player_id"], []).append(dict(r))
    return owners


async def run_injury_watch(conn, season: int, feed: dict, now: datetime.datetime | None = None) -> dict:
    """Diffs the feed against player_injury_status, pushes each change
    to the owners who roster that player, and records the new state."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    entries = parse_injury_feed(feed)
    rows = await conn.fetch(
        "SELECT sleeper_player_id, espn_player_id FROM players WHERE espn_player_id = ANY($1::bigint[])",
        [e["espn_player_id"] for e in entries],
    )
    sleeper_by_espn = {r["espn_player_id"]: r["sleeper_player_id"] for r in rows}
    previous = {
        r["sleeper_player_id"]: dict(r)
        for r in await conn.fetch("SELECT sleeper_player_id, status, news_id, news_at FROM player_injury_status")
    }
    seeding = not previous

    alerts: list[tuple[str, str, str, dict, dict | None]] = []
    changed: list[tuple[str, dict]] = []
    for entry in entries:
        sleeper_id = sleeper_by_espn.get(entry["espn_player_id"])
        if sleeper_id is None:
            continue
        prev = previous.get(sleeper_id)
        if prev and prev["status"] == entry["status"] and prev["news_id"] == entry["news_id"]:
            continue
        changed.append((sleeper_id, entry))
        if seeding:
            continue
        verdict = classify(prev, entry, now)
        if verdict:
            alerts.append((sleeper_id, verdict[0], verdict[1], entry, prev))

    if changed:
        await conn.executemany(
            """
            INSERT INTO player_injury_status (sleeper_player_id, status, injury, news_id, news_at, detail)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (sleeper_player_id) DO UPDATE SET
                status = EXCLUDED.status, injury = EXCLUDED.injury, news_id = EXCLUDED.news_id,
                news_at = EXCLUDED.news_at, detail = EXCLUDED.detail, updated_at = now()
            """,
            [(sid, e["status"], e["injury"], e["news_id"], e["news_at"], e["detail"]) for sid, e in changed],
        )

    sent = 0
    owners = await _roster_owners(conn, season, [a[0] for a in alerts])
    for sleeper_id, kind, direction, entry, prev in alerts:
        pref = "notify_injuries" if kind == "injury" else "notify_player_news"
        for owner in owners.get(sleeper_id, []):
            try:
                prefs = await preferences_queries.get_preferences(conn, owner["owner_id"])
                if not (prefs["push_enabled"] and prefs[pref]):
                    continue
                if kind == "injury":
                    payload = formatter.injury_update(
                        owner["player_name"], direction, entry["status"], prev["status"] if prev else None,
                        entry["injury"], entry["detail"], tag=f"injury-{sleeper_id}",
                    )
                else:
                    payload = formatter.player_news(owner["player_name"], entry["detail"], tag=f"news-{sleeper_id}")
                await dispatcher.send_to_owner(conn, owner["owner_id"], payload, now=now)
                sent += 1
            except Exception:
                logger.exception("Injury alert failed (player=%s owner=%s)", sleeper_id, owner["owner_id"])
    return {"feed_players": len(entries), "changed": len(changed), "alerts": len(alerts), "pushes": sent, "seeded": seeding}


async def notify_in_game_injuries(conn, season: int, week: int) -> int:
    """Pushes every live_injury_status row whose state hasn't been
    announced yet, then marks it announced. A "returned" nobody heard
    the player leave for is just marked, not pushed."""
    rows = await conn.fetch(
        "SELECT sleeper_player_id, state, notified_state FROM live_injury_status "
        "WHERE season = $1 AND week = $2 AND notified_state IS DISTINCT FROM state",
        season, week,
    )
    if not rows:
        return 0
    to_push = [r for r in rows if not (r["state"] == "returned" and r["notified_state"] is None)]
    owners = await _roster_owners(conn, season, [r["sleeper_player_id"] for r in to_push])
    sent = 0
    for r in to_push:
        for owner in owners.get(r["sleeper_player_id"], []):
            try:
                prefs = await preferences_queries.get_preferences(conn, owner["owner_id"])
                if not (prefs["push_enabled"] and prefs["notify_injuries"]):
                    continue
                matchup_id = await conn.fetchval(
                    "SELECT id FROM matchups WHERE season = $1 AND week = $2 AND (home_team_id = $3 OR away_team_id = $3)",
                    season, week, owner["team_id"],
                )
                await dispatcher.send_to_owner(
                    conn, owner["owner_id"],
                    formatter.injury_in_game(
                        owner["player_name"], r["state"], matchup_id, tag=f"injury-{r['sleeper_player_id']}",
                    ),
                )
                sent += 1
            except Exception:
                logger.exception("In-game injury alert failed (player=%s owner=%s)", r["sleeper_player_id"], owner["owner_id"])
    await conn.executemany(
        "UPDATE live_injury_status SET notified_state = $4 WHERE season = $1 AND week = $2 AND sleeper_player_id = $3",
        [(season, week, r["sleeper_player_id"], r["state"]) for r in rows],
    )
    return sent
