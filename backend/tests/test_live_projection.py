"""Live projections (app/domain/live_projection.py) and in-game injury
tracking (app/domain/live_injuries.py). Injury fixtures use the exact
phrasing ESPN produced in real 2026 week 1-2 games."""
from datetime import datetime, timezone

import pytest

from app.domain import live_injuries
from app.domain.live_projection import (
    game_clock_by_pro_team,
    live_projection,
    live_team_total,
    share_of_game_left,
)
from tests.conftest import TEST_SEASON


def _in_progress(share_left):
    return {"status": "in_progress", "share_left": share_left}


# --- Game clock --------------------------------------------------------------

@pytest.mark.parametrize("state,period,clock,expected", [
    ("pre", 0, 0, 1.0),
    ("post", 4, 0, 0.0),
    ("in", 1, 900, 1.0),      # kickoff
    ("in", 1, 450, 0.875),    # halfway through Q1
    ("in", 2, 0, 0.5),        # halftime
    ("in", 3, 450, 0.375),
    ("in", 4, 60, 60 / 3600),
    ("in", 5, 300, 300 / 3600),  # overtime: only its own clock
    ("in", 0, 0, 1.0),        # delayed start reported as in-progress
])
def test_share_of_game_left(state, period, clock, expected):
    assert share_of_game_left(state, period, clock) == pytest.approx(expected)


def test_game_clock_by_pro_team_covers_both_teams():
    clock = game_clock_by_pro_team([
        {"home_team": "BUF", "away_team": "DET", "state": "in", "period": 2, "clock": 0},
        {"home_team": "KC", "away_team": "LV", "state": "pre", "period": 0, "clock": 0},
    ])
    assert clock["DET"] == {"status": "in_progress", "share_left": 0.5}
    assert clock["LV"] == {"status": "scheduled", "share_left": 1.0}


# --- Projection --------------------------------------------------------------

def test_before_kickoff_is_the_pregame_projection():
    assert live_projection(12, None, "WR", {"status": "scheduled", "share_left": 1.0}) == 12
    assert live_projection(12, None, "WR", None) == 12


def test_final_is_exactly_the_points_scored():
    assert live_projection(12, 3.4, "WR", {"status": "final", "share_left": 0.0}) == 3.4


def test_on_projection_pace_stays_on_projection():
    # 6 points at halftime on a 12-point projection: pace is exactly 12.
    assert live_projection(12, 6, "WR", _in_progress(0.5)) == 12


def test_hot_start_goes_up_and_slow_start_goes_down():
    # Halftime, weight on pace = 0.25. Pace 24 -> rest-of-game rate 15.
    assert live_projection(12, 12, "WR", _in_progress(0.5)) == 12 + 0.5 * (0.75 * 12 + 0.25 * 24)
    # Pace 2 -> rest-of-game rate 9.5.
    assert live_projection(12, 1, "WR", _in_progress(0.5)) == 1 + 0.5 * (0.75 * 12 + 0.25 * 2)


def test_early_long_touchdown_is_capped():
    # 2 minutes in, a 75-yard TD (13.5 pts): raw pace would be ~400.
    share_left = 1 - 120 / 3600
    projected = live_projection(12, 13.5, "WR", _in_progress(share_left))
    elapsed = 1 - share_left
    rate = (1 - 0.5 * elapsed) * 12 + 0.5 * elapsed * 36  # pace capped at 3 x 12
    assert projected == pytest.approx(13.5 + share_left * rate, abs=0.01)
    assert projected < 26  # nowhere near "400-point pace"


def test_negative_points_never_project_a_negative_rest_of_game():
    # A QB at -2 after a first-quarter pick six: his pace counts as 0,
    # never negative, so the rest of his game still projects positive.
    assert live_projection(18, -2, "QB", _in_progress(0.75)) == round(-2 + 0.75 * (0.875 * 18), 2)


def test_defense_blends_from_projection_to_actual():
    # D/ST starts at 10 (0 pts / 0 yds allowed tiers) — that's not pace.
    assert live_projection(7, 10, "DEF", _in_progress(1.0)) == 7
    assert live_projection(7, 8, "DEF", _in_progress(0.5)) == 7.5
    assert live_projection(7, 3, "DEF", {"status": "final", "share_left": 0.0}) == 3


@pytest.mark.parametrize("state,expected_rest", [
    (None, 6.0), ("returned", 6.0), ("left", 3.0), ("questionable_return", 3.0),
    ("doubtful_return", 1.5), ("ruled_out", 0.0),
])
def test_injury_scales_the_rest_of_the_game(state, expected_rest):
    assert live_projection(12, 6, "WR", _in_progress(0.5), state) == 6 + expected_rest


def test_live_team_total_counts_starters_only():
    roster = [
        {"lineup_slot": "WR", "points_projected": 12, "points_scored": 6, "position": "WR", "pro_team": "BUF", "player_id": "a"},
        {"lineup_slot": "RB", "points_projected": 10, "points_scored": None, "position": "RB", "pro_team": "KC", "player_id": "b"},
        {"lineup_slot": "BE", "points_projected": 20, "points_scored": 30, "position": "RB", "pro_team": "BUF", "player_id": "c"},
    ]
    clock = {"BUF": _in_progress(0.5), "KC": {"status": "scheduled", "share_left": 1.0}}
    assert live_team_total(roster, clock) == 12 + 10
    assert live_team_total(roster, clock, {"a": "ruled_out"}) == 6 + 10


# --- Injury parsing ----------------------------------------------------------

def _summary(*texts):
    plays = [
        {"text": t, "wallclock": f"2026-09-20T18:{i:02d}:00Z"} for i, t in enumerate(texts)
    ]
    return {"drives": {"previous": [{"plays": plays}]}}


def test_parse_injury_plays_reads_left_and_returned():
    events = live_injuries.parse_injury_plays(_summary(
        "(Shotgun) J.Allen pass short left to D.Kincaid to BUF 24 for 6 yards (C.Clark). BUF-K.Coleman was injured during the play.",
        "(Shotgun) J.Allen pass incomplete short right to J.Palmer (T.Harper). ** Injury Update: BUF-K.Coleman has returned to the game.",
        "C.Williams pass short right to C.Loveland pushed ob at CHI 40 for 3 yards (D.Turner). MIN-T.Ingram-Dawkins was injured during the play.",
        "PENALTY on DET-J.Campbell, Defensive Holding, 2 yards. DET-A.Maddox was injured during the play.",
        "(Shotgun) J.Allen pass incomplete short right to D.Moore. ** Injury Update: CAR-D.Lewis has returned to the game. R.Fitzgerald extra point is GOOD.",
        "D.Swift right tackle to MIN 9 for 4 yards (B.Cashman). ATL-Aj.Terrell was injured during the play.",
    ))
    got = [(e["team"], e["first"], e["last"], e["state"]) for e in events]
    assert got == [
        ("BUF", "K", "Coleman", "left"),
        ("BUF", "K", "Coleman", "returned"),
        ("MIN", "T", "Ingram-Dawkins", "left"),
        ("DET", "A", "Maddox", "left"),
        ("CAR", "D", "Lewis", "returned"),
        ("ATL", "Aj", "Terrell", "left"),
    ]


@pytest.mark.parametrize("comment,expected", [
    ("Pili (concussion) has been ruled out for the remainder of Sunday's game against the Cardinals, John Boyle reports.", "ruled_out"),
    ("Mauigoa (quadriceps) has been ruled out for the rest of Sunday's game against Green Bay.", "ruled_out"),
    ("The Eagles announced that Barkley (neck/shoulder) is questionable to return to Sunday's game against the Titans.", "questionable_return"),
    ("Smith (ankle) is doubtful to return to Monday's game.", "doubtful_return"),
    ("Barkley (neck) has returned to Sunday's game against the Titans.", "returned"),
    ("Banks (toe) has been ruled out ahead of Thursday night's game against the Falcons.", None),
    ("Melton (toe) did not participate at the Cardinals' practice Wednesday.", None),
])
def test_classify_news(comment, expected):
    assert live_injuries.classify_news(comment) == expected


def test_parse_injury_news_reads_athlete_id_from_links():
    feed = {"injuries": [{"injuries": [
        {"shortComment": "Barkley (neck) is questionable to return to Sunday's game.", "date": "2026-09-20T17:24Z",
         "athlete": {"links": [{"href": "https://www.espn.com/nfl/player/_/id/3929630/saquon-barkley"}]}},
        {"shortComment": "Melton did not practice Wednesday.", "date": "2026-09-24T02:12Z",
         "athlete": {"id": "4698113"}},
    ]}]}
    items = live_injuries.parse_injury_news(feed)
    assert [(i["espn_player_id"], i["state"]) for i in items] == [(3929630, "questionable_return")]


# --- Recording (DB) ----------------------------------------------------------

async def _seed_player(conn, sid, name, team, position="WR", espn_id=None):
    await conn.execute(
        "INSERT INTO players (sleeper_player_id, full_name, position, pro_team, espn_player_id, is_draftable) "
        "VALUES ($1, $2, $3, $4, $5, TRUE)",
        sid, name, position, team, espn_id,
    )


async def _cleanup(conn):
    await conn.execute("DELETE FROM live_injury_status WHERE season = $1", TEST_SEASON)


async def test_record_play_injuries_matches_by_team_and_name_latest_wins(pool):
    async with pool.acquire() as conn:
        try:
            await _seed_player(conn, "test-live-coleman", "Keon Coleman", "BUF")
            await _seed_player(conn, "test-live-terrell", "A.J. Terrell", "ATL", position="WR")
            # Two BUF players who'd both match "J.Smith" -> skipped as ambiguous.
            await _seed_player(conn, "test-live-smith1", "Jaylen Smith", "BUF")
            await _seed_player(conn, "test-live-smith2", "Jordan Smith", "BUF", position="TE")

            t = lambda m: datetime(2026, 9, 20, 18, m, tzinfo=timezone.utc)  # noqa: E731
            events = [
                {"team": "BUF", "first": "K", "last": "Coleman", "state": "left", "at": t(1)},
                {"team": "BUF", "first": "K", "last": "Coleman", "state": "returned", "at": t(5)},
                {"team": "ATL", "first": "Aj", "last": "Terrell", "state": "left", "at": t(2)},
                {"team": "BUF", "first": "J", "last": "Smith", "state": "left", "at": t(3)},
            ]
            assert await live_injuries.record_play_injuries(conn, TEST_SEASON, 3, events) == 3

            # An older event arriving later never overwrites a newer one.
            await live_injuries.record_play_injuries(conn, TEST_SEASON, 3, [events[0]])

            states = await live_injuries.get_injury_states(
                conn, TEST_SEASON, 3, ["test-live-coleman", "test-live-terrell", "test-live-smith1"]
            )
            assert states["test-live-coleman"]["state"] == "returned"
            assert states["test-live-terrell"]["state"] == "left"
            assert "test-live-smith1" not in states
        finally:
            await _cleanup(conn)


async def test_record_news_only_counts_blurbs_after_that_players_kickoff(pool):
    async with pool.acquire() as conn:
        try:
            await _seed_player(conn, "test-live-barkley", "Saquon Barkley", "PHI", position="RB", espn_id=990001)
            await _seed_player(conn, "test-live-banks", "Banks Test", "GB", position="WR", espn_id=990002)
            games = [
                {"home_team": "PHI", "away_team": "TEN", "state": "in", "date": "2026-09-20T17:00Z"},
                {"home_team": "GB", "away_team": "ATL", "state": "pre", "date": "2026-09-25T00:15Z"},
            ]
            items = [
                {"espn_player_id": 990001, "state": "ruled_out", "at": datetime(2026, 9, 20, 18, 30, tzinfo=timezone.utc), "detail": "ruled out for the rest"},
                {"espn_player_id": 990002, "state": "ruled_out", "at": datetime(2026, 9, 24, 2, 20, tzinfo=timezone.utc), "detail": "ruled out ahead of Thursday"},
            ]
            assert await live_injuries.record_news_injuries(conn, TEST_SEASON, 3, items, games) == 1
            states = await live_injuries.get_injury_states(conn, TEST_SEASON, 3, ["test-live-barkley", "test-live-banks"])
            assert states == {"test-live-barkley": {"state": "ruled_out", "detail": "ruled out for the rest"}}
        finally:
            await _cleanup(conn)
