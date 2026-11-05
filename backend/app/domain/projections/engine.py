"""
Runs the projection engine for one week (see this package's __init__):

  1. sync_history — real weekly stat lines into nfl_player_weeks: last
     season once, this season's weeks as they finish (the last two are
     always re-read for stat corrections).
  2. sync_game_lines — this week's Vegas lines into nfl_game_lines. Lines
     vanish from ESPN's scoreboard once a game is over, so saving them
     is also what lets past weeks be re-run later.
  3. build_lines — the three sources' stat lines (model, Sleeper, ESPN)
     plus each one's simulated odds, into projection_lines. A player
     whose game has kicked off keeps the line he had: the pregame
     projection is what every "projected vs. scored" comparison judges
     against (live_projection.py moves the in-game number on its own).
  4. score_leagues — every league's own points, per source and blended,
     into league_player_projections.

run_week does all four for the current week; with rest_of_season it
also projects every later week of the regular season (build_lines +
score_leagues per week), which trade values and the rest-of-season
numbers read. A later week only counts long-term absences (IR, PUP,
suspension) as out — this week's "Out" is usually back by then — and
until Vegas posts its line, the week's implied points come from
Sleeper's projected D/ST points allowed. Grading a finished week is
accuracy.grade_week.
"""
import json
import logging
import re

from app.domain.projections import accuracy, stat_lines
from app.domain.projections.distribution import simulate
from app.domain.projections.model import _OUT, _PLAY_SHARE, ProjectionModel
from app.domain.projections.scoring import expected_points, floor_ceiling
from app.domain.scoring_engine import rules_dict_from_rows
from app.providers import projection_feeds as feeds
from app.providers.nfl_scoreboard import get_week_scoreboard

logger = logging.getLogger(__name__)

REGULAR_SEASON_WEEKS = 18
POSITIONS = ("QB", "RB", "WR", "TE", "K", "DEF")
IDP_POSITIONS = ("DL", "DE", "DT", "NT", "LB", "ILB", "OLB", "MLB", "DB", "CB", "S", "SS", "FS")
_LONG_TERM_OUT = {"IR", "PUP", "Suspended", "NFI"}


def _name_key(name: str | None) -> str:
    name = re.sub(r"[^a-z ]", "", (name or "").lower().replace("-", " "))
    return " ".join(re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", name).split())


async def sync_history(conn, season: int, week: int) -> int:
    """Fills nfl_player_weeks through week - 1. Returns weeks fetched."""
    have = {
        (r["season"], r["week"])
        for r in await conn.fetch(
            "SELECT DISTINCT season, week FROM nfl_player_weeks WHERE season IN ($1, $2)", season - 1, season
        )
    }
    wanted = [(season - 1, w) for w in range(1, REGULAR_SEASON_WEEKS + 1) if (season - 1, w) not in have]
    wanted += [(season, w) for w in range(1, week) if (season, w) not in have or w >= week - 2]
    for s, w in wanted:
        rows = await feeds.sleeper_week(s, w, "stats")
        await conn.executemany(
            """
            INSERT INTO nfl_player_weeks (season, week, sleeper_player_id, position, team, opponent, stats)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
            ON CONFLICT (season, week, sleeper_player_id) DO UPDATE SET
                position = EXCLUDED.position, team = EXCLUDED.team, opponent = EXCLUDED.opponent,
                stats = EXCLUDED.stats, synced_at = now()
            """,
            [(s, w, r["sleeper_player_id"], r["position"], r["team"], r["opponent"], json.dumps(r["stats"])) for r in rows],
        )
    return len(wanted)


async def sync_game_lines(conn, season: int, week: int) -> int:
    lines = await feeds.vegas_lines(season, week)
    await conn.executemany(
        """
        INSERT INTO nfl_game_lines (season, week, team, opponent, is_home, spread, total, implied_points)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (season, week, team) DO UPDATE SET
            opponent = EXCLUDED.opponent, is_home = EXCLUDED.is_home, spread = EXCLUDED.spread,
            total = EXCLUDED.total, implied_points = EXCLUDED.implied_points, synced_at = now()
        """,
        [(season, week, l["team"], l["opponent"], l["is_home"], l["spread"], l["total"], l["implied_points"]) for l in lines],
    )
    return len(lines)


async def _game_lines(conn, season: int, week: int, sleeper_rows: list[dict]) -> dict[str, dict]:
    """This week's lines; for a game with none saved, the implied points
    Sleeper's own D/ST projection carries (its projected points allowed)."""
    lines = {
        r["team"]: {
            "opponent": r["opponent"], "spread": float(r["spread"]) if r["spread"] is not None else None,
            "total": float(r["total"]) if r["total"] is not None else None,
            "implied_points": float(r["implied_points"]) if r["implied_points"] is not None else None,
        }
        for r in await conn.fetch("SELECT * FROM nfl_game_lines WHERE season = $1 AND week = $2", season, week)
    }
    fallback = {}
    for r in sleeper_rows:
        if r["position"] == "DEF" and r["stats"].get("pts_allow") and r["opponent"]:
            fallback[r["opponent"]] = {"opponent": r["team"], "implied_points": float(r["stats"]["pts_allow"])}
    for team, line in fallback.items():
        if team in lines:
            continue
        other = fallback.get(line["opponent"])
        theirs = other["implied_points"] if other else line["implied_points"]
        lines[team] = {**line, "total": line["implied_points"] + theirs, "spread": theirs - line["implied_points"]}
    return lines


async def _any_idp_league(conn, season: int) -> bool:
    return bool(await conn.fetchval(
        "SELECT 1 FROM league_scoring_rules WHERE season = $1 AND stat_category LIKE 'idp\\_%' AND points_per_unit <> 0 LIMIT 1",
        season,
    ))


async def _rostered(conn, season: int) -> set[str]:
    return {
        r["sleeper_player_id"]
        for r in await conn.fetch("SELECT DISTINCT sleeper_player_id FROM current_rosters WHERE season = $1", season)
    }


def _apply_availability(sources: dict[str, dict[str, dict]], universe: dict[str, dict], rostered: set[str]) -> None:
    """Injury status is the engine's call, not each feed's: Sleeper's and
    ESPN's projections lag on it (an IR'd receiver can still carry a full
    line). A player ruled out (Out, IR, PUP, suspended…) gets one explicit
    zero line — every source dropped — so no source, and no screen's old
    fallback projection, can put points back on him. A doubtful or
    questionable player's outside lines are scaled by the same chance he
    plays that the model already applies to its own."""
    for pid, info in universe.items():
        status = info.get("injury_status")
        if status in _OUT:
            if pid in rostered or any(pid in by_player for by_player in sources.values()):
                for by_player in sources.values():
                    by_player.pop(pid, None)
                sources["model"][pid] = {"_out": 1.0, "_why": {"status": status}}
            continue
        share = _PLAY_SHARE.get(status)
        if share is None:
            continue
        for source in ("sleeper", "espn"):
            line = sources[source].get(pid)
            if line:
                sources[source][pid] = {
                    k: (v * share if isinstance(v, (int, float)) and k not in ("_pts_allow", "_yds_allow") else v)
                    for k, v in line.items()
                }


async def build_lines(conn, season: int, week: int, *, future: bool = False) -> dict[str, int]:
    """All three sources' stat lines for the week. Returns {source: players}.
    future: a week after the current one (see the module docstring)."""
    positions = list(POSITIONS) + (list(IDP_POSITIONS) if await _any_idp_league(conn, season) else [])
    players = await conn.fetch(
        """
        SELECT sleeper_player_id, full_name, position, pro_team, injury_status, espn_player_id
        FROM players WHERE position = ANY($1::text[]) AND pro_team IS NOT NULL
        """,
        positions,
    )

    def status(value):
        if not future:
            return value
        return value if value in _LONG_TERM_OUT else None

    universe = {
        r["sleeper_player_id"]: {"position": r["position"], "team": r["pro_team"], "injury_status": status(r["injury_status"])}
        for r in players
    }
    by_espn = {r["espn_player_id"]: r["sleeper_player_id"] for r in players if r["espn_player_id"]}
    by_name = {}
    for r in players:
        by_name.setdefault((_name_key(r["full_name"]), r["position"]), r["sleeper_player_id"])

    sleeper_rows = await feeds.sleeper_week(season, week, "projections")
    history = [
        {**dict(r), "stats": json.loads(r["stats"])}
        for r in await conn.fetch(
            "SELECT season, week, sleeper_player_id, position, team, opponent, stats FROM nfl_player_weeks "
            "WHERE season IN ($1, $2)",
            season - 1, season,
        )
    ]
    lines = await _game_lines(conn, season, week, sleeper_rows)

    sources: dict[str, dict[str, dict]] = {"model": ProjectionModel(history, season, week).project(universe, lines)}
    sources["sleeper"] = {
        r["sleeper_player_id"]: stat_lines.from_sleeper(r["stats"], r["position"])
        for r in sleeper_rows if r["sleeper_player_id"] in universe and r["opponent"]
    }
    espn: dict[str, dict] = {}
    try:
        for e in await feeds.espn_week_projections(season, week):
            if e["position"] == "DEF":
                pid = e["team"]
            else:
                pid = by_espn.get(e["espn_id"]) or by_name.get((_name_key(e["name"]), e["position"]))
            if pid in universe:
                espn[pid] = stat_lines.from_espn(e["stats"], e["position"])
    except Exception:
        logger.warning("ESPN projections fetch failed (season=%s week=%s)", season, week, exc_info=True)
    sources["espn"] = espn
    _apply_availability(sources, universe, await _rostered(conn, season))

    started = {
        feeds.team_code(team)
        for g in await get_week_scoreboard(week, season) if g.get("state") != "pre"
        for team in (g.get("home_team"), g.get("away_team"))
    }
    locked = [pid for pid, info in universe.items() if feeds.team_code(info["team"]) in started]
    locked_set = set(locked)

    rows = []
    for source, by_player in sources.items():
        for pid, line in by_player.items():
            if pid in locked_set:
                continue
            position = universe[pid]["position"]
            if line.get("_out"):
                rows.append((season, week, pid, source, position, json.dumps(line), "{}", 0, 0))
                continue
            if not any(v for k, v in line.items() if not k.startswith("_") and isinstance(v, (int, float))):
                continue
            sim = simulate(line, position, f"{season}-{week}-{pid}-{source}")
            rows.append((season, week, pid, source, position, json.dumps(line), json.dumps(sim["probs"]),
                         sim["floor_ratio"], sim["ceiling_ratio"]))
    async with conn.transaction():
        await conn.execute(
            "DELETE FROM projection_lines WHERE season = $1 AND week = $2 AND NOT (sleeper_player_id = ANY($3::text[]))",
            season, week, locked,
        )
        await conn.executemany(
            """
            INSERT INTO projection_lines
                (season, week, sleeper_player_id, source, position, line, probs, floor_ratio, ceiling_ratio)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
            """,
            rows,
        )
    return {source: len(by_player) for source, by_player in sources.items()}


async def score_leagues(conn, season: int, week: int, league_ids: list[int] | None = None) -> int:
    """Every league's own projections for the week, from projection_lines."""
    if league_ids is None:
        league_ids = [
            r["league_id"]
            for r in await conn.fetch("SELECT DISTINCT league_id FROM league_scoring_rules WHERE season = $1", season)
        ]
    lines = await conn.fetch(
        "SELECT sleeper_player_id, source, position, line, probs, floor_ratio, ceiling_ratio "
        "FROM projection_lines WHERE season = $1 AND week = $2",
        season, week,
    )
    by_player: dict[str, list] = {}
    for r in lines:
        by_player.setdefault(r["sleeper_player_id"], []).append(
            (r["source"], r["position"], json.loads(r["line"]), json.loads(r["probs"]), r["floor_ratio"], r["ceiling_ratio"])
        )
    weights = await accuracy.blend_weights(conn, season)
    written = 0
    for league_id in league_ids:
        rules = rules_dict_from_rows(await conn.fetch(
            "SELECT stat_category, points_per_unit FROM league_scoring_rules WHERE league_id = $1 AND season = $2",
            league_id, season,
        ))
        if not rules:
            continue
        rows = []
        for pid, entries in by_player.items():
            position = entries[0][1]
            points = {source: expected_points(line, probs, position, rules) for source, _, line, probs, _, _ in entries}
            blended = accuracy.blend(points, weights.get(position, accuracy.DEFAULT_WEIGHTS))
            # Floor/ceiling from the blend's sources' spreads, averaged.
            lows, highs = [], []
            for source, _, _, probs, floor_ratio, ceiling_ratio in entries:
                low, high = floor_ceiling(blended, position, floor_ratio, ceiling_ratio, probs)
                if low is not None:
                    lows.append(low)
                if high is not None:
                    highs.append(high)
            rows.append((
                league_id, season, week, pid, round(blended, 2),
                round(sum(lows) / len(lows), 2) if lows else None,
                round(sum(highs) / len(highs), 2) if highs else None,
                json.dumps({s: round(p, 2) for s, p in points.items()}),
            ))
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM league_player_projections WHERE league_id = $1 AND season = $2 AND week = $3",
                league_id, season, week,
            )
            await conn.executemany(
                """
                INSERT INTO league_player_projections
                    (league_id, season, week, sleeper_player_id, projected_points, floor_points, ceiling_points, by_source)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
                """,
                rows,
            )
        written += len(rows)
    return written


async def run_week(pool, season: int, week: int, *, rest_of_season: bool = False, last_week: int = 17) -> dict:
    async with pool.acquire() as conn:
        out = {"history_weeks": await sync_history(conn, season, week)}
        try:
            out["game_lines"] = await sync_game_lines(conn, season, week)
        except Exception:
            logger.warning("Vegas lines fetch failed (season=%s week=%s)", season, week, exc_info=True)
            out["game_lines"] = 0
        if week > 1:
            out["graded"] = await accuracy.grade_week(conn, season, week - 1)
        out["lines"] = await build_lines(conn, season, week)
        out["league_rows"] = await score_leagues(conn, season, week)
        if rest_of_season:
            out["future_weeks"] = []
            for later in range(week + 1, last_week + 1):
                try:
                    await build_lines(conn, season, later, future=True)
                    await score_leagues(conn, season, later)
                    out["future_weeks"].append(later)
                except Exception:
                    logger.warning("Rest-of-season projection failed (season=%s week=%s)", season, later, exc_info=True)
    return out
