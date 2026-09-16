"""Defense-vs-position matchup rankings ("MIN (22nd) vs RB") — one row
per (season, week, pro_team, position). Sourced from ESPN's own
mPositionalRatings view via app/providers/espn/adapter.py, which
already fetches this data as a side effect of the existing roster
sync (see that module's own comment) — this file only handles
persisting/reading it, not fetching.

rank 1 = fewest fantasy points allowed to that position = toughest
matchup; rank 32 = most allowed = easiest matchup — confirmed against
real live ESPN data during planning, not assumed. See the migration
(465f0b1ffe3f) for the full rationale on scope (QB/RB/WR/TE/K, not
D/ST) and the one-row-per-team-position-week normalization.
"""

_COLUMNS = ("season", "week", "pro_team", "position", "rank", "average_allowed")


async def upsert_rankings(conn, season: int, week: int, rows: list[dict]) -> None:
    """rows: [{"pro_team": "MIN", "position": "RB", "rank": 22, "average_allowed": 24.1}, ...]
    Full replace-by-key semantics via ON CONFLICT — a week's rankings
    can legitimately shift between syncs as more games are played, so
    this always trusts the latest fetch rather than merging."""
    if not rows:
        return
    values = [(season, week, r["pro_team"], r["position"], r["rank"], r["average_allowed"]) for r in rows]
    await conn.executemany(
        """
        INSERT INTO team_position_rankings (season, week, pro_team, position, rank, average_allowed)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (season, week, pro_team, position) DO UPDATE SET
            rank = EXCLUDED.rank,
            average_allowed = EXCLUDED.average_allowed
        """,
        values,
    )


async def get_rankings(conn, season: int, week: int) -> dict[tuple[str, str], dict]:
    """(pro_team, position) -> {"rank": int, "average_allowed": float} for
    every row this week — one bulk fetch per request (My Team, Free
    Agents, Matchup all need many lookups at once), not N individual
    queries per player."""
    records = await conn.fetch(
        "SELECT pro_team, position, rank, average_allowed FROM team_position_rankings WHERE season = $1 AND week = $2",
        season, week,
    )
    return {
        (r["pro_team"], r["position"]): {"rank": r["rank"], "average_allowed": float(r["average_allowed"])}
        for r in records
    }
