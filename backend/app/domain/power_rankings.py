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
from app.domain.weekly_team_stats import regular_season_games, compute_power_scores, team_season_stats
from app.queries import power_rankings as queries

_TOP_N = 3


def _movement(power_rank: int, prev_power_rank: int | None) -> int | None:
    """Positive = moved up (a lower rank number is better), negative =
    moved down, None if there's no prior week to compare against."""
    if prev_power_rank is None:
        return None
    return prev_power_rank - power_rank


def _rank_by(values: dict[int, float], descending: bool = True) -> dict[int, int]:
    ordered = sorted(values, key=lambda tid: values[tid], reverse=descending)
    return {tid: i + 1 for i, tid in enumerate(ordered)}


async def get_season_context(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> dict[int, dict]:
    """Everything behind a team's power rank through `week` (2026-10
    overhaul), per team_id: record, points per game, all-play %,
    expected wins and luck in wins, recent form, strength of schedule
    so far and still to come (1 = hardest), the standings position, and
    a one-line note on what stands out. Computed live from the scores —
    the same numbers weekly_team_stats.py ranks with."""
    stats = team_season_stats(await regular_season_games(conn, season, week, league_id))
    if not stats:
        return {}
    scores = compute_power_scores(list(stats.values()))
    remaining = await conn.fetch(
        """
        SELECT home_team_id, away_team_id FROM matchups
        WHERE season = $1 AND league_id = $2 AND week > $3 AND is_playoff = FALSE
        """,
        season, league_id, week,
    )
    future: dict[int, list[int]] = {tid: [] for tid in stats}
    for m in remaining:
        if m["home_team_id"] in future:
            future[m["home_team_id"]].append(m["away_team_id"])
        if m["away_team_id"] in future:
            future[m["away_team_id"]].append(m["home_team_id"])

    def strength(opponents: list[int]) -> float | None:
        known = [stats[o]["all_play_pct"] for o in opponents if o in stats]
        return sum(known) / len(known) if known else None

    sos_past = {tid: strength(t["opponents"]) for tid, t in stats.items()}
    sos_future = {tid: strength(future[tid]) for tid in stats}
    sos_past_rank = _rank_by({k: v for k, v in sos_past.items() if v is not None})
    sos_future_rank = _rank_by({k: v for k, v in sos_future.items() if v is not None})
    all_play_rank = _rank_by({tid: t["all_play_pct"] for tid, t in stats.items()})
    form_rank = _rank_by({tid: t["recent_form"] for tid, t in stats.items()})
    standings_rank = _rank_by({tid: (t["win_pct"], t["avg_points"]) for tid, t in stats.items()})
    power_rank = _rank_by(scores)
    n = len(stats)

    out = {}
    for tid, t in stats.items():
        notes = []
        if power_rank[tid] <= standings_rank[tid] - 3:
            notes.append("Better than their record")
        elif power_rank[tid] >= standings_rank[tid] + 3:
            notes.append("Record flatters them")
        if t["luck_wins"] >= 0.75:
            notes.append(f"Lucky: {t['luck_wins']:.1f} more wins than their scores earned")
        elif t["luck_wins"] <= -0.75:
            notes.append(f"Unlucky: {abs(t['luck_wins']):.1f} fewer wins than their scores earned")
        if all_play_rank[tid] == 1:
            notes.append("Best all-play record in the league")
        if t["games"] >= 3 and form_rank[tid] == 1:
            notes.append("Hottest team over the last 3 weeks")
        elif t["games"] >= 3 and form_rank[tid] == n:
            notes.append("Coldest team over the last 3 weeks")
        if sos_past_rank.get(tid) == 1:
            notes.append("Toughest schedule so far")
        if sos_future_rank.get(tid) == 1:
            notes.append("Toughest road ahead")
        elif sos_future_rank.get(tid) == len(sos_future_rank) and sos_future_rank:
            notes.append("Easiest road ahead")
        record = f"{t['wins']}-{t['losses']}" + (f"-{t['ties']}" if t["ties"] else "")
        out[tid] = {
            "record": record,
            "standings_rank": standings_rank[tid],
            "points_per_game": round(t["avg_points"], 1),
            "recent_form": round(t["recent_form"], 1),
            "all_play_pct": round(t["all_play_pct"], 3),
            "expected_wins": round(t["expected_wins"], 2),
            "luck_wins": round(t["luck_wins"], 2),
            "sos": round(sos_past[tid], 3) if sos_past[tid] is not None else None,
            "sos_rank": sos_past_rank.get(tid),
            "sos_remaining": round(sos_future[tid], 3) if sos_future[tid] is not None else None,
            "sos_remaining_rank": sos_future_rank.get(tid),
            "power_score": round(scores[tid], 3),
            "note": " · ".join(notes[:2]) or None,
        }
    return out


async def get_week_power_rankings(conn, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID):
    rows = await queries.get_week_power_rankings(conn, season, week, league_id)
    context = await get_season_context(conn, season, week, league_id)
    return [
        {
            "team_id": r["team_id"],
            "team_name": r["team_name"],
            "owner_id": r["owner_id"],
            "owner_name": r["owner_name"],
            "power_rank": r["power_rank"],
            # This week's luck on the -50..50 scale (weekly_team_stats.
            # compute_luck_score); the season's, in wins, is luck_wins.
            "luck_score": float(r["luck_score"]) if r["luck_score"] is not None else None,
            "sos": float(r["sos"]) if r["sos"] is not None else None,
            "movement": _movement(r["power_rank"], r["prev_power_rank"]),
            **{k: v for k, v in context.get(r["team_id"], {}).items() if k != "sos"},
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
