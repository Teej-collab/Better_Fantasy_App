"""
In-game injury tracking for live projections (app/domain/
live_projection.py). Two free ESPN sources, both checked against real
2026 weeks 1-2 data before this was written:

- Play-by-play (the same game summary app/providers/nfl_stats/
  espn_public.py already fetches every scoring poll) only ever says two
  things: "BUF-K.Coleman was injured during the play." (92 times across
  weeks 1-2) and "** Injury Update: BUF-K.Coleman has returned to the
  game." (63). Plays carry no player id, only TEAM-Initial.Lastname, so
  they're matched by name within that NFL team (fantasy positions only,
  and skipped when more than one player could match).
- ESPN's league-wide injuries feed (one call covers all 32 teams) is
  where rulings show up: blurbs like "... is questionable to return to
  Sunday's game" or "... has been ruled out for the remainder of
  Sunday's game". Its `status` field doesn't change for these (it stays
  "Questionable"), so the blurb text is what's classified. Entries carry
  ESPN athlete ids, matched exactly via players.espn_player_id. Only
  blurbs timestamped after that player's kickoff count.

The latest event per player per week wins (live_injury_status keeps
one row each). Everything here is best-effort: a parsing or fetch
problem is logged and skipped, never allowed to block scoring.
"""
import logging
import re
from datetime import datetime

logger = logging.getLogger(__name__)

_NAME = r"([A-Z]{2,3})-([A-Z][A-Za-z']{0,3})\.\s?([A-Z][\w'.\- ]*?)"
_LEFT_RE = re.compile(_NAME + r" was injured during the play")
_RETURNED_RE = re.compile(r"Injury Update: " + _NAME + r" has returned to the game")

_RULED_OUT_RE = re.compile(
    r"ruled out for the (rest|remainder)|won't return|will not return|won't be returning|"
    r"out for the (rest|remainder)|done for the (day|night|game)",
    re.I,
)
_DOUBTFUL_RE = re.compile(r"doubtful to return", re.I)
_QUESTIONABLE_RE = re.compile(r"questionable to return", re.I)
_RETURNED_NEWS_RE = re.compile(r"has returned to|returned to the game|back in the game", re.I)

_FANTASY_POSITIONS = ("QB", "RB", "WR", "TE", "K")
_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _norm(text: str) -> str:
    return re.sub(r"[^a-z]", "", text.lower())


def _last_name_key(last: str) -> str:
    parts = [p for p in re.split(r"\s+", last.strip()) if _norm(p) not in _SUFFIXES]
    return _norm("".join(parts))


def parse_injury_plays(summary: dict) -> list[dict]:
    """[{team, first, last, state ("left"|"returned"), at}] in play order."""
    events = []
    for drive in (summary.get("drives") or {}).get("previous", []):
        for play in drive.get("plays", []):
            text = play.get("text") or ""
            at = _parse_time(play.get("wallclock") or play.get("modified"))
            if at is None:
                continue
            for regex, state in ((_LEFT_RE, "left"), (_RETURNED_RE, "returned")):
                for m in regex.finditer(text):
                    events.append({"team": m.group(1), "first": m.group(2), "last": m.group(3), "state": state, "at": at})
    return events


def classify_news(comment: str | None) -> str | None:
    """In-game ruling from an ESPN injury blurb, or None if it isn't one."""
    if not comment:
        return None
    if _RULED_OUT_RE.search(comment):
        return "ruled_out"
    if _DOUBTFUL_RE.search(comment):
        return "doubtful_return"
    if _QUESTIONABLE_RE.search(comment):
        return "questionable_return"
    if _RETURNED_NEWS_RE.search(comment):
        return "returned"
    return None


def parse_injury_news(feed: dict) -> list[dict]:
    """[{espn_player_id, state, at, detail}] for every blurb that reads
    as an in-game ruling."""
    items = []
    for team in feed.get("injuries", []):
        for entry in team.get("injuries", []):
            state = classify_news(entry.get("shortComment"))
            at = _parse_time(entry.get("date"))
            athlete = entry.get("athlete") or {}
            espn_id = athlete.get("id")
            if not espn_id:
                for link in athlete.get("links", []):
                    m = re.search(r"/id/(\d+)", link.get("href", ""))
                    if m:
                        espn_id = m.group(1)
                        break
            if state and at and espn_id:
                items.append({"espn_player_id": int(espn_id), "state": state, "at": at, "detail": entry.get("shortComment")})
    return items


async def _players_by_team(conn, teams: set[str]) -> dict[str, list[dict]]:
    rows = await conn.fetch(
        "SELECT sleeper_player_id, full_name, pro_team FROM players "
        "WHERE pro_team = ANY($1::text[]) AND position = ANY($2::text[])",
        list(teams), list(_FANTASY_POSITIONS),
    )
    by_team: dict[str, list[dict]] = {}
    for r in rows:
        name = (r["full_name"] or "").split(" ", 1)
        if len(name) < 2:
            continue
        by_team.setdefault(r["pro_team"], []).append(
            {"id": r["sleeper_player_id"], "first": _norm(name[0]), "last": _last_name_key(name[1])}
        )
    return by_team


def _match(candidates: list[dict], first: str, last: str) -> str | None:
    first_key, last_key = _norm(first), _last_name_key(last)
    hits = [c["id"] for c in candidates if c["last"] == last_key and c["first"].startswith(first_key)]
    return hits[0] if len(hits) == 1 else None


async def _upsert(conn, season: int, week: int, sleeper_id: str, state: str, source: str, detail: str | None, at) -> None:
    await conn.execute(
        """
        INSERT INTO live_injury_status (season, week, sleeper_player_id, state, source, detail, event_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (season, week, sleeper_player_id) DO UPDATE SET
            state = EXCLUDED.state, source = EXCLUDED.source, detail = EXCLUDED.detail,
            event_at = EXCLUDED.event_at, updated_at = now()
        WHERE live_injury_status.event_at <= EXCLUDED.event_at
        """,
        season, week, sleeper_id, state, source, detail, at,
    )


async def record_play_injuries(conn, season: int, week: int, events: list[dict]) -> int:
    if not events:
        return 0
    by_team = await _players_by_team(conn, {e["team"] for e in events})
    recorded = 0
    for e in events:
        sleeper_id = _match(by_team.get(e["team"], []), e["first"], e["last"])
        if sleeper_id is None:
            continue
        detail = f"{e['first']}.{e['last']} " + ("left the game" if e["state"] == "left" else "returned")
        await _upsert(conn, season, week, sleeper_id, e["state"], "play", detail, e["at"])
        recorded += 1
    return recorded


async def record_news_injuries(conn, season: int, week: int, items: list[dict], games: list[dict]) -> int:
    """Only blurbs posted after that player's own kickoff this week."""
    if not items:
        return 0
    kickoff_by_team = {}
    for g in games:
        kickoff = _parse_time(g.get("date"))
        if kickoff and g.get("state") in ("in", "post"):
            for team in (g.get("home_team"), g.get("away_team")):
                if team:
                    kickoff_by_team[team] = kickoff
    rows = await conn.fetch(
        "SELECT sleeper_player_id, espn_player_id, pro_team FROM players WHERE espn_player_id = ANY($1::bigint[])",
        [i["espn_player_id"] for i in items],
    )
    by_espn = {r["espn_player_id"]: r for r in rows}
    recorded = 0
    for item in items:
        player = by_espn.get(item["espn_player_id"])
        if player is None:
            continue
        kickoff = kickoff_by_team.get(player["pro_team"])
        if kickoff is None or item["at"] < kickoff:
            continue
        await _upsert(conn, season, week, player["sleeper_player_id"], item["state"], "news", item["detail"], item["at"])
        recorded += 1
    return recorded


async def get_injury_states(conn, season: int, week: int, sleeper_ids: list[str]) -> dict[str, dict]:
    """sleeper_player_id -> {"state", "detail"} for this week. Empty
    (never an error) if the table doesn't exist yet, so the page keeps
    working through a deploy that lands before its migration."""
    if not sleeper_ids or not await conn.fetchval("SELECT to_regclass('live_injury_status')"):
        return {}
    rows = await conn.fetch(
        "SELECT sleeper_player_id, state, detail FROM live_injury_status "
        "WHERE season = $1 AND week = $2 AND sleeper_player_id = ANY($3::text[])",
        season, week, list(sleeper_ids),
    )
    return {r["sleeper_player_id"]: {"state": r["state"], "detail": r["detail"]} for r in rows}
