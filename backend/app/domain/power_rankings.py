"""
Power Rankings, Luck Index, and Strength of Schedule — surfaces
weekly_team_stats' power_rank/luck_score/sos columns
(app/domain/weekly_team_stats.py computes and stores these on every
sync, already backfilled for every historical season a full sync has
run against) as three real views: this week's ranked list with
movement vs. last week, a full-season trend, and an all-time
leaderboard. The all-time leaderboard is computed live on every
request straight from weekly_team_stats, same "no separate table, no
recompute job" convention app/domain/records.py already uses for the
record book — not a fourth thing to keep in sync.
"""
from app.config import DEFAULT_LEAGUE_ID
from app.queries import power_rankings as queries

_TOP_N = 3


def _movement(power_rank: int, prev_power_rank: int | None) -> int | None:
    """Positive = moved up (a lower rank number is better), negative =
    moved down, None if there's no prior week to compare against."""
    if prev_power_rank is None:
        return None
    return prev_power_rank - power_rank


async def get_week_power_rankings(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID):
    rows = await queries.get_week_power_rankings(conn, season, week, league_id)
    return [
        {
            "team_id": r["team_id"],
            "team_name": r["team_name"],
            "owner_id": r["owner_id"],
            "owner_name": r["owner_name"],
            "power_rank": r["power_rank"],
            "luck_score": float(r["luck_score"]) if r["luck_score"] is not None else None,
            "sos": float(r["sos"]) if r["sos"] is not None else None,
            "movement": _movement(r["power_rank"], r["prev_power_rank"]),
        }
        for r in rows
    ]


async def get_latest_ranked_week(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> int | None:
    return await queries.get_latest_ranked_week(conn, season, league_id)


async def get_season_trend(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    rows = await queries.get_season_power_rank_trend(conn, season, league_id)
    by_team: dict[int, dict] = {}
    for r in rows:
        team = by_team.setdefault(
            r["team_id"],
            {
                "team_id": r["team_id"],
                "team_name": r["team_name"],
                "owner_id": r["owner_id"],
                "owner_name": r["owner_name"],
                "weeks": [],
            },
        )
        team["weeks"].append({"week": r["week"], "power_rank": r["power_rank"]})
    return list(by_team.values())


def _entries(rows):
    return [{"owner_id": r["owner_id"], "owner_name": r["owner_name"], "value": float(r["value"])} for r in rows]


async def get_all_time_indices(conn, league_id: int = DEFAULT_LEAGUE_ID):
    most_at_one = await queries.most_weeks_at_number_one(conn, _TOP_N, league_id)
    best_avg_rank = await queries.career_avg_power_rank(conn, _TOP_N, descending=False, league_id=league_id)
    luckiest = await queries.career_avg_luck(conn, _TOP_N, descending=True, league_id=league_id)
    unluckiest = await queries.career_avg_luck(conn, _TOP_N, descending=False, league_id=league_id)
    toughest = await queries.career_avg_sos(conn, _TOP_N, descending=True, league_id=league_id)
    easiest = await queries.career_avg_sos(conn, _TOP_N, descending=False, league_id=league_id)

    return {
        "categories": [
            {
                "key": "most_weeks_at_one",
                "label": "Most Weeks at #1",
                "emoji": "👑",
                "unit": "weeks",
                "entries": [
                    {"owner_id": r["owner_id"], "owner_name": r["owner_name"], "value": r["value"]}
                    for r in most_at_one
                ],
            },
            {
                "key": "best_career_power_rank",
                "label": "Best Career Power Rank",
                "emoji": "📈",
                "unit": "avg rank",
                "entries": _entries(best_avg_rank),
            },
            {
                "key": "luckiest",
                "label": "Luckiest All-Time",
                "emoji": "🍀",
                "unit": "avg luck",
                "entries": _entries(luckiest),
            },
            {
                "key": "unluckiest",
                "label": "Unluckiest All-Time",
                "emoji": "💀",
                "unit": "avg luck",
                "entries": _entries(unluckiest),
            },
            {
                "key": "toughest_schedule",
                "label": "Toughest Schedule All-Time",
                "emoji": "🥊",
                "unit": "avg SOS",
                "entries": _entries(toughest),
            },
            {
                "key": "easiest_schedule",
                "label": "Easiest Schedule All-Time",
                "emoji": "🛋️",
                "unit": "avg SOS",
                "entries": _entries(easiest),
            },
        ]
    }
