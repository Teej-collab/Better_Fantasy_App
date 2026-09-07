"""
The second, league-specific ticker (as opposed to AppTickerBar's real
NFL scores): every matchup's current score plus each side's own
highest-scoring starter this week — a deliberately lighter query than
build_week_matchup_context (app/domain/matchup_context.py), which this
would otherwise duplicate wastefully. No streaks, head-to-head, or
rivalry lookups here; the ticker only ever needs the score and one
name+number per side, refreshed on the same cadence the frontend
already polls the NFL ticker with during a live window (see
GameDayRefresher.tsx) — that's the "live during the live week" part,
there's no separate push/websocket path for this.
"""
from app.config import DEFAULT_LEAGUE_ID
from app.queries import league as queries

_STARTER_EXCLUDED_SLOTS = {"BE", "IR"}


def _top_scorer(roster_rows):
    starters = [
        r for r in roster_rows
        if r["lineup_slot"] not in _STARTER_EXCLUDED_SLOTS and r["points_scored"] is not None
    ]
    if not starters:
        return None
    best = max(starters, key=lambda r: r["points_scored"])
    return {"player_name": best["player_name"], "points_scored": float(best["points_scored"])}


async def get_week_ticker_data(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID):
    matchups = [dict(m) for m in await queries.list_week_matchups(conn, season, week, league_id)]
    items = []
    for m in matchups:
        # ESPN represents an unplayed matchup as a real 0/0, not NULL —
        # same convention queries.get_standings/get_head_to_head already
        # exclude on ("a genuine 0-0 tie is not realistic in fantasy
        # football"). This endpoint never applied that rule, so an
        # unplayed matchup's real 0.0/0.0 sailed through looking like
        # live data, under a "Live" ticker label — 2026-09-02 audit.
        # This is specifically "this week's live scores," so it should
        # only ever return matchups with something live or final to
        # show; both frontend callers already skip rendering the ticker
        # strip entirely when items is empty, so an all-unplayed week
        # just omits the strip with no further change needed.
        home_score, away_score = m["home_score"], m["away_score"]
        started = home_score is not None and away_score is not None and not (home_score == 0 and away_score == 0)
        if not started:
            continue

        home_team = await queries.get_team(conn, m["home_team_id"])
        away_team = await queries.get_team(conn, m["away_team_id"])
        home_roster = await queries.get_current_roster(conn, season, m["home_team_id"], week)
        away_roster = await queries.get_current_roster(conn, season, m["away_team_id"], week)

        items.append(
            {
                "matchup_id": m["matchup_id"],
                "home_team_name": home_team["team_name"],
                "home_score": float(m["home_score"]) if m["home_score"] is not None else None,
                "home_top_scorer": _top_scorer(home_roster),
                "away_team_name": away_team["team_name"],
                "away_score": float(m["away_score"]) if m["away_score"] is not None else None,
                "away_top_scorer": _top_scorer(away_roster),
            }
        )

    return {"season": season, "week": week, "items": items}
