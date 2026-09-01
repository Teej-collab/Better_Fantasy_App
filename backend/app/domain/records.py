"""
The all-time record book (Awards page) — top-3 leaderboards per record
category, computed live from app/queries/records.py on every request.
Deliberately not cached or stored in its own table: with league data
this size, three cheap aggregate queries cost nothing, and computing
live is what makes the record book "auto-update the instant a record
is broken" for free, with no recompute job to keep in sync.
"""
from app.config import DEFAULT_LEAGUE_ID
from app.queries import records as queries

_TOP_N = 3


def _entry(row, *, week: int | None = None, opponent_team_name: str | None = None, opponent_score: float | None = None):
    return {
        "owner_id": row["owner_id"],
        "owner_name": row["owner_name"],
        "team_name": row["team_name"],
        "season": row["season"],
        "week": week,
        "opponent_team_name": opponent_team_name,
        "opponent_score": opponent_score,
    }


async def get_record_book(conn, league_id: int = DEFAULT_LEAGUE_ID):
    highest = await queries.top_single_week_scores(conn, _TOP_N, descending=True, league_id=league_id)
    lowest = await queries.top_single_week_scores(conn, _TOP_N, descending=False, league_id=league_id)
    blowouts = await queries.top_blowouts(conn, _TOP_N, league_id)
    season_totals = await queries.top_season_point_totals(conn, _TOP_N, league_id)

    return {
        "categories": [
            {
                "key": "highest_week",
                "label": "Highest Single-Week Score",
                "emoji": "🔥",
                "unit": "pts",
                "entries": [
                    {**_entry(r, week=r["week"]), "value": float(r["score"])} for r in highest
                ],
            },
            {
                "key": "lowest_week",
                "label": "Lowest Single-Week Score",
                "emoji": "🥶",
                "unit": "pts",
                "entries": [
                    {**_entry(r, week=r["week"]), "value": float(r["score"])} for r in lowest
                ],
            },
            {
                "key": "biggest_blowout",
                "label": "Biggest Blowout",
                "emoji": "💥",
                "unit": "pt margin",
                "entries": [
                    {
                        "owner_id": r["winner_owner_id"],
                        "owner_name": r["winner_owner_name"],
                        "team_name": r["winner_team"],
                        "season": r["season"],
                        "week": r["week"],
                        "value": float(r["margin"]),
                        "opponent_team_name": r["loser_team"],
                        "opponent_score": float(r["loser_score"]),
                        "own_score": float(r["winner_score"]),
                    }
                    for r in blowouts
                ],
            },
            {
                "key": "season_total",
                "label": "Most Points in a Season",
                "emoji": "🏆",
                "unit": "pts",
                "entries": [
                    {**_entry(r), "value": float(r["total_points"])} for r in season_totals
                ],
            },
        ]
    }
