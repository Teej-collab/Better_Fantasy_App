from datetime import datetime, timedelta, timezone

from app.domain.win_prob_history import turning_points


def _row(minutes, pct, home_points, away_points):
    return {
        "captured_at": datetime(2026, 10, 11, 17, tzinfo=timezone.utc) + timedelta(minutes=minutes),
        "home_win_pct": pct,
        "home_points": home_points,
        "away_points": away_points,
    }


def test_turning_points_name_the_player_who_scored_for_the_side_that_gained():
    rows = [
        _row(0, 50.0, {"Irving": 0.0, "Bowers": 0.0}, {"Likely": 0.0}),
        _row(5, 52.0, {"Irving": 1.0, "Bowers": 0.0}, {"Likely": 0.0}),  # too small
        _row(10, 74.0, {"Irving": 9.2, "Bowers": 1.0}, {"Likely": 0.0}),  # home +22: Irving
        _row(15, 49.0, {"Irving": 9.2, "Bowers": 1.0}, {"Likely": 12.4}),  # away +25: Likely
    ]
    points = turning_points(rows)
    assert [(p["side"], p["player_name"], p["home_win_pct_change"]) for p in points] == [
        ("home", "Irving", 22.0),
        ("away", "Likely", -25.0),
    ]
    assert points[0]["points"] == 8.2


def test_turning_points_keeps_only_the_biggest_in_time_order():
    rows = [_row(0, 50.0, {}, {})]
    pct = 50.0
    for i, swing in enumerate([10, -12, 30, -9, 15], start=1):
        pct += swing
        rows.append(_row(i * 5, pct, {}, {}))
    points = turning_points(rows, limit=3)
    assert [p["home_win_pct_change"] for p in points] == [-12.0, 30.0, 15.0]


async def test_get_history_returns_the_line_and_turning_points(pool):
    import json

    from app.domain.win_prob_history import get_history
    from tests.conftest import DEFAULT_LEAGUE_ID, TEST_SEASON

    matchup_id = 990_000_001
    start = datetime(2026, 10, 11, 17, tzinfo=timezone.utc)
    async with pool.acquire() as conn:
        try:
            for minutes, pct, home, away in [
                (0, 50.0, {"Irving": 0.0}, {"Likely": 0.0}),
                (10, 72.0, {"Irving": 9.0}, {"Likely": 0.0}),
            ]:
                await conn.execute(
                    """
                    INSERT INTO matchup_win_prob_snapshots
                        (season, league_id, week, matchup_id, captured_at, home_win_pct, home_score, away_score, home_points, away_points)
                    VALUES ($1, $2, 5, $3, $4, $5, $6, 0, $7::jsonb, $8::jsonb)
                    """,
                    TEST_SEASON, DEFAULT_LEAGUE_ID, matchup_id, start + timedelta(minutes=minutes), pct,
                    sum(home.values()), json.dumps(home), json.dumps(away),
                )
            history = await get_history(conn, DEFAULT_LEAGUE_ID, matchup_id)
        finally:
            await conn.execute("DELETE FROM matchup_win_prob_snapshots WHERE matchup_id = $1", matchup_id)

    assert [p["home_win_pct"] for p in history["points"]] == [50.0, 72.0]
    assert history["turning_points"][0]["player_name"] == "Irving"
    assert history["turning_points"][0]["home_win_pct_change"] == 22.0
