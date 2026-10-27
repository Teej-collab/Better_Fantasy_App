"""
Real market ADP for the draft (2026-10-27), from Fantasy Football
Calculator (app/providers/ffc_adp.py). See migration d3f5b7c9e1a4.

The feed only ever shows its latest window of drafts, so:
- snapshot_preseason_adp saves one copy a day, per format a league
  here actually uses, during the preseason (app/scheduler.py's ADP job).
- freeze_for_draft pins the newest copy to a draft when it starts
  (app/domain/draft_engine.py's start_draft), and saves every player's
  projection at that moment. Autopick, the draft room and draft grades
  all read that pinned copy, so a draft is always judged against the
  market it was actually drafted in.

A draft with no copy (the feed was down, or a season before this
existed) falls back to Sleeper's search_rank for autopick and the
league's own value board for grades, exactly as before.

Players are matched by name, position and team, never guessed: a name
that matches nobody, or two players the team can't tell apart, is kept
with a NULL sleeper_player_id and logged.
"""
import logging
import re
from datetime import date

import httpx

from app.providers import ffc_adp

logger = logging.getLogger(__name__)

# The preseason window the daily job saves in (month, day), inclusive.
SNAPSHOT_WINDOW = ((7, 15), (9, 15))

_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}
# Fantasy Football Calculator's position -> ours.
_POSITIONS = {"PK": "K", "DEF": "DEF"}
# Team abbreviations other feeds have used -> Sleeper's.
_TEAM_ALIASES = {"JAC": "JAX", "WSH": "WAS", "LA": "LAR", "OAK": "LV", "SD": "LAC", "STL": "LAR"}


def normalize_name(name: str) -> str:
    """'Kenneth Walker III' and 'Kenneth Walker' -> 'kenneth walker';
    'D.K. Metcalf' -> 'dk metcalf'."""
    words = re.sub(r"[^a-z0-9 ]", "", name.lower().replace("-", " ")).split()
    return " ".join(w for w in words if w not in _SUFFIXES)


def _team(team: str | None) -> str | None:
    return _TEAM_ALIASES.get(team, team) if team else None


def match_players(entries: list[dict], players: list[dict]) -> dict[int, str | None]:
    """ffc player_id -> sleeper_player_id (None when unmatched or
    ambiguous). `players`: {"sleeper_player_id", "full_name",
    "position", "pro_team"}. A team defense matches on its team, which
    is the defense's sleeper_player_id."""
    by_key: dict[tuple[str, str], list[dict]] = {}
    defenses = set()
    for p in players:
        if p["position"] == "DEF":
            defenses.add(p["sleeper_player_id"])
        elif p["full_name"]:
            by_key.setdefault((normalize_name(p["full_name"]), p["position"]), []).append(p)

    matched = {}
    for e in entries:
        position = _POSITIONS.get(e["position"], e["position"])
        team = _team(e.get("team"))
        if position == "DEF":
            matched[e["player_id"]] = team if team in defenses else None
            continue
        candidates = by_key.get((normalize_name(e["name"]), position), [])
        if len(candidates) > 1:
            candidates = [c for c in candidates if c["pro_team"] == team]
        matched[e["player_id"]] = candidates[0]["sleeper_player_id"] if len(candidates) == 1 else None
    return matched


def nearest_team_size(team_count: int | None) -> int:
    return min(ffc_adp.TEAM_SIZES, key=lambda size: abs(size - (team_count or 12)))


async def league_adp_format(conn, season: int, league_id: int) -> tuple[str, int]:
    """(feed format, league size) a league's draft should be compared to."""
    league = await conn.fetchrow(
        "SELECT league_type, roster_preset, team_count FROM leagues WHERE id = $1", league_id
    )
    team_count = (league and league["team_count"]) or await conn.fetchval(
        "SELECT count(*) FROM teams_by_season WHERE season = $1 AND league_id = $2", season, league_id
    )
    teams = nearest_team_size(team_count)
    if league and league["league_type"] == "dynasty":
        return "dynasty", teams
    if league and league["roster_preset"] in ("superflex", "2qb"):
        return "2qb", teams
    rec = await conn.fetchval(
        "SELECT points_per_unit FROM league_scoring_rules WHERE league_id = $1 AND season = $2 AND stat_category = 'rec'",
        league_id, season,
    )
    rec = float(rec or 0)
    if rec >= 1:
        return "ppr", teams
    return ("half-ppr", teams) if rec > 0 else ("standard", teams)


async def save_snapshot(
    conn, season: int, fmt: str, teams: int, today: date, at_draft_start: bool = False,
) -> int | None:
    """Fetches one format and stores it as today's copy. Returns the
    snapshot id (the existing one if today's copy is already saved),
    or None when the feed couldn't be reached or had no players."""
    existing = await conn.fetchval(
        "SELECT id FROM adp_snapshots WHERE season = $1 AND format = $2 AND teams = $3 AND fetched_on = $4",
        season, fmt, teams, today,
    )
    if existing:
        return existing
    try:
        # A draft is waiting on this one, so give up sooner.
        data = await ffc_adp.fetch_adp(fmt, teams, season, timeout=8 if at_draft_start else 20)
    except httpx.HTTPError:
        logger.exception(
            "ADP fetch failed: season=%s format=%s teams=%s at_draft_start=%s", season, fmt, teams, at_draft_start
        )
        return None
    entries = data.get("players") or []
    if not entries:
        return None

    players = await conn.fetch(
        "SELECT sleeper_player_id, full_name, position, pro_team FROM players "
        "WHERE position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')"
    )
    matched = match_players(entries, [dict(p) for p in players])
    meta = data.get("meta") or {}
    async with conn.transaction():
        snapshot_id = await conn.fetchval(
            """
            INSERT INTO adp_snapshots (season, format, teams, fetched_on, total_drafts, window_start, window_end)
            VALUES ($1, $2, $3, $4, $5, $6::text::date, $7::text::date)
            ON CONFLICT (season, format, teams, fetched_on) DO UPDATE SET total_drafts = EXCLUDED.total_drafts
            RETURNING id
            """,
            season, fmt, teams, today, meta.get("total_drafts"), meta.get("start_date"), meta.get("end_date"),
        )
        await conn.executemany(
            """
            INSERT INTO adp_entries (snapshot_id, ffc_player_id, sleeper_player_id, name, position, team, adp, stdev, times_drafted)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (snapshot_id, ffc_player_id) DO NOTHING
            """,
            [
                (
                    snapshot_id, e["player_id"], matched.get(e["player_id"]), e["name"],
                    _POSITIONS.get(e["position"], e["position"]), e.get("team"), e["adp"], e.get("stdev"),
                    e.get("times_drafted"),
                )
                for e in entries
            ],
        )
    unmatched = [e["name"] for e in entries if matched.get(e["player_id"]) is None]
    if unmatched:
        logger.warning("ADP %s/%s: %d of %d players unmatched: %s", fmt, teams, len(unmatched), len(entries), unmatched)
    return snapshot_id


def in_snapshot_window(today: date) -> bool:
    (start_m, start_d), (end_m, end_d) = SNAPSHOT_WINDOW
    return (start_m, start_d) <= (today.month, today.day) <= (end_m, end_d)


async def snapshot_preseason_adp(conn, season: int, today: date) -> int:
    """Saves today's copy of every format a league here uses. Returns
    how many copies were saved (already-saved ones count)."""
    league_ids = [r["id"] for r in await conn.fetch("SELECT id FROM leagues")]
    formats = {await league_adp_format(conn, season, league_id) for league_id in league_ids}
    saved = 0
    for fmt, teams in sorted(formats):
        if await save_snapshot(conn, season, fmt, teams, today):
            saved += 1
    return saved


async def freeze_for_draft(conn, season: int, league_id: int, today: date) -> int | None:
    """Pins ADP and projections to a draft that's about to start. A
    no-op once the draft is past not_started or already has a copy.
    Uses the newest saved copy for the league's format (its size first,
    then any size), fetching one now if none is saved. Never raises on
    a feed problem — a draft without ADP still runs."""
    config = await conn.fetchrow(
        "SELECT status, adp_snapshot_id FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
    )
    if config is None or config["status"] != "not_started" or config["adp_snapshot_id"] is not None:
        return config["adp_snapshot_id"] if config else None

    fmt, teams = await league_adp_format(conn, season, league_id)
    snapshot_id = await conn.fetchval(
        """
        SELECT id FROM adp_snapshots
        WHERE season = $1 AND format = $2 AND fetched_on <= $4
        ORDER BY fetched_on DESC, (teams = $3) DESC
        LIMIT 1
        """,
        season, fmt, teams, today,
    )
    fresh = await conn.fetchval(
        "SELECT 1 FROM adp_snapshots WHERE id = $1 AND fetched_on = $2", snapshot_id, today
    ) if snapshot_id else None
    if not fresh:
        snapshot_id = await save_snapshot(conn, season, fmt, teams, today, at_draft_start=True) or snapshot_id

    await conn.execute(
        "UPDATE draft_config SET adp_snapshot_id = $3 WHERE season = $1 AND league_id = $2",
        season, league_id, snapshot_id,
    )
    await conn.execute(
        """
        INSERT INTO draft_projection_snapshots (season, league_id, sleeper_player_id, projected_points)
        SELECT $1, $2, sleeper_player_id, projected_points FROM players WHERE projected_points IS NOT NULL
        ON CONFLICT (season, league_id, sleeper_player_id) DO NOTHING
        """,
        season, league_id,
    )
    return snapshot_id


async def adp_for_draft(conn, season: int, league_id: int) -> dict[str, float]:
    """sleeper_player_id -> ADP (overall pick number) in the copy this
    draft is pinned to; empty when it has none."""
    rows = await conn.fetch(
        """
        SELECT ae.sleeper_player_id, ae.adp FROM adp_entries ae
        JOIN draft_config dc ON dc.adp_snapshot_id = ae.snapshot_id
        WHERE dc.season = $1 AND dc.league_id = $2 AND ae.sleeper_player_id IS NOT NULL
        """,
        season, league_id,
    )
    return {r["sleeper_player_id"]: float(r["adp"]) for r in rows}
