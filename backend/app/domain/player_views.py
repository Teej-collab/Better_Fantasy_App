"""
The "Views" menu on the Available (free agents) list and the Roster tab
— ESPN's per-list stat views, rebuilt on data this app can actually get:

  matchup     — not served here; the lists' own PROJ/SCORE columns
  scoring     — POS RK / AVG / PTS / LAST, from this league's own
                player_week_stats (the points every matchup is scored on)
  research    — OPP RK, ESPN %ROST / %START (only for the ~22% of players
                with an espn_player_id crosswalk), and Sleeper's 24h
                add/drop trend in place of ESPN's %ROST change
  schedule    — BYE plus each remaining week's opponent
  rankings    — this week's projection, scored under THIS league's rules,
                ranked within position
  ppr_rankings— same projection ranked by standard full-PPR points
  proj_2026 / stats_2026 / stats_2025 — ESPN's season stat tables

Stats and projections come from Sleeper's free public API
(api.sleeper.app), keyed by the same sleeper_player_id the `players`
table already uses — one request covers every player, cached here.
Fantasy points everywhere are this league's own scoring (the same
compute_player_points the weekly compute uses), except stats_2026's
FPTS, which is the real stored player_week_stats total so it matches
every other screen exactly.
"""
import asyncio
import logging
import time

import httpx

from app.domain.scoring_engine import compute_player_points, rules_dict_from_rows
from app.domain.stat_derivations import derive_stat_line
from app.providers.espn.player_info import REGULAR_SEASON_WEEKS, get_bulk_ownership
from app.providers.nfl_scoreboard import get_week_scoreboard
from app.providers.nfl_stats.espn_public import _POINTS_ALLOWED_TIERS, _YARDS_ALLOWED_TIERS, _tier_category
from app.queries import league as league_queries
from app.queries import team_position_rankings as position_rankings_queries

logger = logging.getLogger(__name__)

VIEWS = {"scoring", "research", "schedule", "rankings", "ppr_rankings", "proj_2026", "stats_2026", "stats_2025"}

_SLEEPER = "https://api.sleeper.app/v1"
_CACHE: dict[str, tuple[float, object]] = {}


async def _cached(key: str, ttl: float, fetch):
    hit = _CACHE.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    value = await fetch()
    _CACHE[key] = (time.monotonic() + ttl, value)
    return value


async def _sleeper(path: str, ttl: float):
    async def fetch():
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(f"{_SLEEPER}{path}")
            response.raise_for_status()
            return response.json()

    return await _cached(f"sleeper:{path}", ttl, fetch)


async def season_stats(season: int) -> dict:
    return await _sleeper(f"/stats/nfl/regular/{season}", 3600)


async def season_projections(season: int) -> dict:
    return await _sleeper(f"/projections/nfl/regular/{season}", 6 * 3600)


async def week_projections(season: int, week: int) -> dict:
    return await _sleeper(f"/projections/nfl/regular/{season}/{week}", 1800)


async def trending() -> dict[str, int]:
    """{sleeper_player_id: adds - drops} across every Sleeper league,
    last 24 hours."""
    adds, drops = await asyncio.gather(
        _sleeper("/players/nfl/trending/add?lookback_hours=24&limit=500", 1800),
        _sleeper("/players/nfl/trending/drop?lookback_hours=24&limit=500", 1800),
    )
    net: dict[str, int] = {}
    for row in adds:
        net[row["player_id"]] = net.get(row["player_id"], 0) + row["count"]
    for row in drops:
        net[row["player_id"]] = net.get(row["player_id"], 0) - row["count"]
    return net


async def season_schedule(season: int) -> dict[str, dict[int, str]]:
    """{pro_team: {week: "IND" | "@NYG"}} for the whole regular season.
    18 scoreboard calls the first time, then cached for 12 hours — the
    schedule only changes on the rare flexed game."""

    async def fetch():
        weeks = range(1, REGULAR_SEASON_WEEKS + 1)
        results = await asyncio.gather(*(get_week_scoreboard(w, season) for w in weeks), return_exceptions=True)
        schedule: dict[str, dict[int, str]] = {}
        for week, games in zip(weeks, results):
            if isinstance(games, BaseException):
                continue
            for g in games:
                home, away = g.get("home_team"), g.get("away_team")
                if home and away:
                    schedule.setdefault(home, {})[week] = away
                    schedule.setdefault(away, {})[week] = f"@{home}"
        return schedule

    return await _cached(f"schedule:{season}", 12 * 3600, fetch)


# ---- Sleeper stats -> this league's scoring categories ----------------------

# Same names on both sides for most of the offense.
_DIRECT = {
    "pass_yd": "pass_yd", "pass_td": "pass_td", "pass_int": "pass_int",
    "rush_yd": "rush_yd", "rush_td": "rush_td",
    "rec": "rec", "rec_yd": "rec_yd", "rec_td": "rec_td",
    "fum_lost": "fum_lost",
    "pass_2pt": "two_pt_pass", "rush_2pt": "two_pt_rush", "rec_2pt": "two_pt_rec",
    "kr_td": "ret_td", "pr_td": "ret_td",
    "xpm": "xp_made", "fgm_yds": "fg_yds",
    "fgmiss_0_19": "fg_miss_0_29", "fgmiss_20_29": "fg_miss_0_29", "fgmiss_30_39": "fg_miss_30_39",
    "fgmiss_40_49": "fg_miss_40_49", "fgmiss_50p": "fg_miss_50_plus",
}
_DEF_DIRECT = {
    "sack": "def_sack", "int": "def_int", "fum_rec": "def_fum_rec", "safe": "def_safety",
    "blk_kick": "def_block", "def_td": "def_return_td", "def_st_td": "def_return_td",
}


def league_stat_line(stats: dict, position: str) -> dict[str, float]:
    """Sleeper stat dict -> {league category: count}. A D/ST's
    points/yards-allowed tiers are per game, so they're applied to the
    per-game average and multiplied back out by games played — exact
    for a single-week projection (gp 1), an approximation for a season."""
    line: dict[str, float] = {}
    mapping = _DEF_DIRECT if position == "DEF" else _DIRECT
    for key, category in mapping.items():
        value = stats.get(key)
        if value:
            line[category] = line.get(category, 0) + float(value)
    if position == "DEF":
        games = float(stats.get("gp") or 1) or 1
        if stats.get("pts_allow") is not None:
            tier = _tier_category(round(float(stats["pts_allow"]) / games), _POINTS_ALLOWED_TIERS)
            line[tier] = line.get(tier, 0) + games
        if stats.get("yds_allow") is not None:
            tier = _tier_category(round(float(stats["yds_allow"]) / games), _YARDS_ALLOWED_TIERS)
            line[tier] = line.get(tier, 0) + games
    return line


def league_points(stats: dict | None, position: str, rules: dict[str, float]) -> float | None:
    if not stats:
        return None
    return compute_player_points(derive_stat_line(league_stat_line(stats, position), position), rules)


# ---- Column sets ------------------------------------------------------------

def _stat_groups(positions: set[str]) -> list[str]:
    groups: list[str] = []
    if "QB" in positions:
        groups.append("passing")
    if positions & {"QB", "RB", "WR", "TE"}:
        groups.append("rushing")
    if positions & {"RB", "WR", "TE"}:
        groups.append("receiving")
    if "K" in positions:
        groups.append("kicking")
    if "DEF" in positions:
        groups.append("defense")
    return groups


_GROUP_COLUMNS: dict[str, list[dict]] = {
    "passing": [
        {"key": "pass_ca", "label": "C/A", "format": "text"},
        {"key": "pass_yd", "label": "YDS", "format": "int"},
        {"key": "pass_td", "label": "TD", "format": "int"},
        {"key": "pass_int", "label": "INT", "format": "int"},
    ],
    "rushing": [
        {"key": "rush_att", "label": "CAR", "format": "int"},
        {"key": "rush_yd", "label": "YDS", "format": "int"},
        {"key": "rush_td", "label": "TD", "format": "int"},
    ],
    "receiving": [
        {"key": "rec", "label": "REC", "format": "int"},
        {"key": "rec_yd", "label": "YDS", "format": "int"},
        {"key": "rec_td", "label": "TD", "format": "int"},
        {"key": "rec_tgt", "label": "TAR", "format": "int"},
    ],
    "kicking": [
        {"key": "fg", "label": "FG", "format": "text"},
        {"key": "xp", "label": "XP", "format": "text"},
    ],
    "defense": [
        {"key": "sack", "label": "SACK", "format": "int"},
        {"key": "int", "label": "INT", "format": "int"},
        {"key": "fum_rec", "label": "FR", "format": "int"},
        {"key": "def_td", "label": "TD", "format": "int"},
        {"key": "pts_allow", "label": "PA", "format": "int"},
    ],
}
_GROUP_LABELS = {"passing": "Passing", "rushing": "Rushing", "receiving": "Receiving", "kicking": "Kicking", "defense": "Defense"}


_FG_MADE_BUCKETS = {"fgm_0_19", "fgm_20_29", "fgm_30_39", "fgm_40_49", "fgm_50p"}


def _stat_values(stats: dict) -> dict:
    """Sleeper stat dict -> the raw column values above."""
    def ratio(made, att):
        if stats.get(made) is None and stats.get(att) is None:
            return None
        # Sleeper's season projections carry makes without attempts.
        if stats.get(att) is None:
            return f"{int(stats.get(made) or 0)}"
        return f"{int(stats.get(made) or 0)}/{int(stats.get(att) or 0)}"

    values = {
        key: stats.get(key)
        for key in ("pass_yd", "pass_td", "pass_int", "rush_att", "rush_yd", "rush_td", "rec", "rec_yd",
                    "rec_td", "rec_tgt", "sack", "int", "fum_rec", "pts_allow")
    }
    values["pass_ca"] = ratio("pass_cmp", "pass_att")
    if stats.get("fgm") is None and any(k.startswith("fgm_") and k[4].isdigit() for k in stats):
        # Season projections only carry makes by distance bucket.
        made = sum(v for k, v in stats.items() if k in _FG_MADE_BUCKETS)
        values["fg"] = f"{int(made)}"
    else:
        values["fg"] = ratio("fgm", "fga")
    values["xp"] = ratio("xpm", "xpa")
    values["def_td"] = (stats.get("def_td") or 0) + (stats.get("def_st_td") or 0) if stats else None
    return values


# ---- Views ------------------------------------------------------------------

async def build_view(conn, view: str, player_ids: list[str], season: int, week: int, league_id: int) -> dict:
    players = {
        r["sleeper_player_id"]: r
        for r in await conn.fetch(
            "SELECT sleeper_player_id, espn_player_id, position, pro_team FROM players "
            "WHERE sleeper_player_id = ANY($1::text[])",
            player_ids,
        )
    }
    rules = rules_dict_from_rows(await conn.fetch(
        "SELECT stat_category, points_per_unit FROM league_scoring_rules WHERE season = $1 AND league_id = $2",
        season, league_id,
    ))

    if view == "scoring":
        return await _scoring_view(conn, players, season, week, league_id)
    if view == "research":
        return await _research_view(conn, players, season, week)
    if view == "schedule":
        return await _schedule_view(conn, players, season, week)
    if view in ("rankings", "ppr_rankings"):
        return await _rankings_view(conn, view, players, season, week, rules)
    return await _stats_view(conn, view, players, season, league_id, rules)


async def _scoring_view(conn, players, season, week, league_id) -> dict:
    rows = await conn.fetch(
        """
        SELECT pws.sleeper_player_id, p.position, pws.week, pws.fantasy_points::float AS pts
        FROM player_week_stats pws JOIN players p ON p.sleeper_player_id = pws.sleeper_player_id
        WHERE pws.season = $1 AND pws.league_id = $2 AND pws.week <= $3
        """,
        season, league_id, week,
    )
    totals: dict[str, dict] = {}
    for r in rows:
        t = totals.setdefault(r["sleeper_player_id"], {"position": r["position"], "pts": 0.0, "games": 0, "last": None, "last_week": 0})
        t["pts"] += r["pts"]
        t["games"] += 1
        if r["week"] > t["last_week"]:
            t["last_week"], t["last"] = r["week"], r["pts"]
    pos_rank = _rank_within_position({pid: (t["position"], t["pts"]) for pid, t in totals.items()})

    out = {}
    for pid in players:
        t = totals.get(pid)
        out[pid] = {
            "pos_rk": pos_rank.get(pid),
            "avg": round(t["pts"] / t["games"], 2) if t else None,
            "pts": round(t["pts"], 2) if t else None,
            "last": t["last"] if t else None,
        }
    return {
        "columns": [
            {"key": "pos_rk", "label": "POS RK", "format": "int"},
            {"key": "avg", "label": "AVG", "format": "number2"},
            {"key": "pts", "label": "PTS", "format": "number2"},
            {"key": "last", "label": "LAST", "format": "number2"},
        ],
        "rows": out,
    }


def _rank_within_position(values: dict[str, tuple[str, float | None]]) -> dict[str, int]:
    by_position: dict[str, list[tuple[str, float]]] = {}
    for pid, (position, value) in values.items():
        if value is not None:
            by_position.setdefault(position, []).append((pid, value))
    ranks: dict[str, int] = {}
    for entries in by_position.values():
        entries.sort(key=lambda e: e[1], reverse=True)
        for i, (pid, _) in enumerate(entries, start=1):
            ranks[pid] = i
    return ranks


_RANKED_POSITIONS = {"QB", "RB", "WR", "TE", "K"}
_SEASON_GAMES = 17


async def _research_view(conn, players, season, week) -> dict:
    rankings = await position_rankings_queries.get_rankings(conn, season, week)
    schedule = await season_schedule(season)
    try:
        trend = await trending()
    except Exception:
        logger.warning("Sleeper trending fetch failed", exc_info=True)
        trend = {}

    espn_ids = {r["espn_player_id"]: pid for pid, r in players.items() if r["espn_player_id"]}
    ownership: dict[str, dict] = {}
    if espn_ids:
        try:
            by_espn = await asyncio.wait_for(
                asyncio.to_thread(get_bulk_ownership, list(espn_ids), season=season), timeout=8
            )
            ownership = {espn_ids[e]: data for e, data in by_espn.items() if e in espn_ids}
        except Exception:
            logger.warning("ESPN ownership fetch failed for the research view", exc_info=True)

    out = {}
    for pid, r in players.items():
        opponent = (schedule.get(r["pro_team"] or "", {}).get(week) or "").lstrip("@")
        rank = rankings.get((opponent, r["position"])) if opponent and r["position"] in _RANKED_POSITIONS else None
        own = ownership.get(pid) or {}
        out[pid] = {
            "opp_rk": rank["rank"] if rank else None,
            "rost": own.get("percent_owned"),
            "start": own.get("percent_started"),
            "trend": trend.get(pid),
        }
    return {
        "columns": [
            {"key": "opp_rk", "label": "OPP RK", "format": "ordinal_matchup"},
            {"key": "rost", "label": "%ROST", "format": "number1"},
            {"key": "start", "label": "%START", "format": "number1"},
            {"key": "trend", "label": "TREND", "format": "signed_int"},
        ],
        "rows": out,
        "note": "%ROST/%START are ESPN's and only available for some players. TREND is net adds minus drops across Sleeper leagues in the last 24 hours.",
    }


async def _schedule_view(conn, players, season, week) -> dict:
    schedule = await season_schedule(season)
    byes = await league_queries.get_bye_weeks(conn, season)
    weeks = list(range(max(1, week), REGULAR_SEASON_WEEKS + 1))
    out = {}
    for pid, r in players.items():
        team = r["pro_team"] or ""
        row = {"bye": byes.get(team)}
        for w in weeks:
            row[f"wk{w}"] = schedule.get(team, {}).get(w) or ("BYE" if byes.get(team) == w else None)
        out[pid] = row
    return {
        "columns": [{"key": "bye", "label": "BYE", "format": "int"}]
        + [{"key": f"wk{w}", "label": f"WK {w}", "format": "text"} for w in weeks],
        "rows": out,
    }


async def _rankings_view(conn, view, players, season, week, rules) -> dict:
    projections = await week_projections(season, week)
    positions = {
        r["sleeper_player_id"]: r["position"]
        for r in await conn.fetch(
            "SELECT sleeper_player_id, position FROM players WHERE sleeper_player_id = ANY($1::text[])",
            list(projections),
        )
    }
    if view == "rankings":
        points = {pid: league_points(stats, positions[pid], rules) for pid, stats in projections.items() if pid in positions}
    else:
        points = {pid: stats.get("pts_ppr") for pid, stats in projections.items() if pid in positions}
    # Only players actually projected to play count toward a rank.
    ranks = _rank_within_position({pid: (positions[pid], pts) for pid, pts in points.items() if pts})
    out = {pid: {"rank": ranks.get(pid), "proj": points.get(pid)} for pid in players}
    label = "PROJ" if view == "rankings" else "PPR PROJ"
    return {
        "columns": [
            {"key": "rank", "label": "RANK", "format": "ordinal"},
            {"key": "proj", "label": label, "format": "number1"},
        ],
        "rows": out,
        "note": (
            f"Week {week} projections ranked within each position under this league's scoring."
            if view == "rankings"
            else f"Week {week} projections ranked within each position under standard full-PPR scoring."
        ),
    }


async def _stats_view(conn, view, players, season, league_id, rules) -> dict:
    if view == "proj_2026":
        source = await season_projections(season)
    elif view == "stats_2026":
        source = await season_stats(season)
    else:
        source = await season_stats(season - 1)

    league_totals: dict[str, float] = {}
    if view == "stats_2026":
        league_totals = {
            r["sleeper_player_id"]: r["pts"]
            for r in await conn.fetch(
                "SELECT sleeper_player_id, sum(fantasy_points)::float AS pts FROM player_week_stats "
                "WHERE season = $1 AND league_id = $2 AND sleeper_player_id = ANY($3::text[]) GROUP BY 1",
                season, league_id, list(players),
            )
        }

    groups = _stat_groups({r["position"] for r in players.values()})
    # Fantasy points first: the number people are looking for shouldn't
    # sit past a sideways scroll (2026-09 report: "most data is missing").
    columns: list[dict] = [
        {"key": "fpts", "label": "FPTS", "format": "number1", "group": "Fantasy"},
        {"key": "avg", "label": "AVG", "format": "number1", "group": "Fantasy"},
    ]
    for group in groups:
        columns += [{**c, "group": _GROUP_LABELS[group]} for c in _GROUP_COLUMNS[group]]

    out = {}
    for pid, r in players.items():
        stats = source.get(pid) or {}
        row = _stat_values(stats) if stats else {}
        fpts = league_totals.get(pid) if view == "stats_2026" else league_points(stats, r["position"], rules)
        # Season projections' games-played is missing or meaningless (a
        # D/ST's reads 1), so a projected average is over a full season.
        games = _SEASON_GAMES if view == "proj_2026" and stats else (stats.get("gp") or None)
        row["fpts"] = round(fpts, 1) if fpts is not None else None
        row["avg"] = round(fpts / games, 1) if fpts is not None and games else None
        out[pid] = row
    return {"columns": columns, "rows": out}
