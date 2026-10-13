"""
Each live matchup's win % through the week (2026-10-13), for the living
home's Monday sweat: a line of how the odds moved and the turning points
— the biggest swings, each with the player whose points caused it.

capture() runs from the live score sync (app/scheduler.py) at most every
CAPTURE_EVERY_SECONDS, and only stores a snapshot when a matchup's score
moved. Each snapshot keeps both sides' starters' points at that moment,
so a swing between two snapshots can be put down to whoever scored in
between.
"""
import json
import logging
import time

from app.domain.matchup_context import build_week_matchup_context

logger = logging.getLogger(__name__)

CAPTURE_EVERY_SECONDS = 120
# A swing smaller than this (percentage points) isn't a turning point.
TURNING_POINT_MIN = 8.0
_BENCH = {"BE", "IR", "TAXI"}

_last_capture = 0.0


def _starter_points(side: dict) -> dict[str, float]:
    return {
        p["player_name"]: float(p["points_scored"] or 0)
        for p in side.get("roster") or []
        if p.get("lineup_slot") not in _BENCH and p.get("player_name")
    }


async def capture(conn, season: int, week: int, force: bool = False) -> int:
    """Stores a snapshot for every matchup this week whose score changed.
    Returns how many were stored."""
    global _last_capture
    if not force and time.monotonic() - _last_capture < CAPTURE_EVERY_SECONDS:
        return 0
    _last_capture = time.monotonic()

    stored = 0
    league_ids = [
        r["league_id"]
        for r in await conn.fetch("SELECT DISTINCT league_id FROM matchups WHERE season = $1 AND week = $2", season, week)
    ]
    for league_id in league_ids:
        context = await build_week_matchup_context(conn, season, week, league_id)
        for m in context["matchups"]:
            home, away = m["home"], m["away"]
            home_score, away_score = float(home["score"] or 0), float(away["score"] or 0)
            if home["win_probability"] is None or home_score + away_score == 0:
                continue
            last = await conn.fetchrow(
                "SELECT home_score, away_score FROM matchup_win_prob_snapshots WHERE matchup_id = $1 ORDER BY captured_at DESC LIMIT 1",
                m["matchup_id"],
            )
            if last and abs(last["home_score"] - home_score) < 0.05 and abs(last["away_score"] - away_score) < 0.05:
                continue
            await conn.execute(
                """
                INSERT INTO matchup_win_prob_snapshots
                    (season, league_id, week, matchup_id, home_win_pct, home_score, away_score, home_points, away_points)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
                """,
                season, league_id, week, m["matchup_id"], float(home["win_probability"]), home_score, away_score,
                json.dumps(_starter_points(home)), json.dumps(_starter_points(away)),
            )
            stored += 1
    return stored


def _biggest_scorer(before: dict, after: dict) -> tuple[str | None, float]:
    best, gain = None, 0.0
    for name, points in after.items():
        delta = points - before.get(name, 0.0)
        if delta > gain:
            best, gain = name, delta
    return best, gain


def turning_points(rows: list[dict], limit: int = 3) -> list[dict]:
    """The biggest win-% swings between consecutive snapshots, from the
    home side's view, each put down to the player who scored the most on
    the side that gained."""
    swings = []
    for before, after in zip(rows, rows[1:]):
        delta = after["home_win_pct"] - before["home_win_pct"]
        if abs(delta) < TURNING_POINT_MIN:
            continue
        side = "home" if delta > 0 else "away"
        player, points = _biggest_scorer(before[f"{side}_points"], after[f"{side}_points"])
        swings.append({
            "at": after["captured_at"],
            "home_win_pct_change": round(delta, 1),
            "side": side,
            "player_name": player,
            "points": round(points, 1),
        })
    swings.sort(key=lambda s: abs(s["home_win_pct_change"]), reverse=True)
    return sorted(swings[:limit], key=lambda s: s["at"])


async def get_history(conn, league_id: int, matchup_id: int) -> dict:
    raw = await conn.fetch(
        """
        SELECT captured_at, home_win_pct, home_score, away_score, home_points, away_points
        FROM matchup_win_prob_snapshots
        WHERE league_id = $1 AND matchup_id = $2
        ORDER BY captured_at
        """,
        league_id, matchup_id,
    )
    rows = [
        {
            **dict(r),
            "home_points": r["home_points"] if isinstance(r["home_points"], dict) else json.loads(r["home_points"]),
            "away_points": r["away_points"] if isinstance(r["away_points"], dict) else json.loads(r["away_points"]),
        }
        for r in raw
    ]
    return {
        "points": [
            {"at": r["captured_at"].isoformat(), "home_win_pct": r["home_win_pct"], "home_score": r["home_score"], "away_score": r["away_score"]}
            for r in rows
        ],
        "turning_points": [{**t, "at": t["at"].isoformat()} for t in turning_points(rows)],
    }
