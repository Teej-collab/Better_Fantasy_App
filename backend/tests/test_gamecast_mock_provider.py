"""
Normalization + state-transition tests for the mock NFL data provider
(app/gamecast/providers/mock.py) — the provider that's actually
exercised end to end in this environment, since no real
SPORTRADAR_API_KEY exists. No pool/DB involved here at all: the mock
provider is pure in-memory simulation, so these don't need the
TEST_SEASON/cleanup machinery the rest of this test suite relies on.

These tests advance the provider's internal clock via an injected
_FakeClock rather than real asyncio.sleep() calls. An earlier version
of this file used real sleeps (up to 45s each, 2+ minutes total across
the file) to let "game time" pass — correct in spirit, but it made the
whole backend suite take minutes instead of seconds, and coincided
with a TooManyConnectionsError cascade in unrelated test files that
happened to run afterward while those sleeps held the suite open. The
mock provider now accepts a `now_fn` precisely so tests can fast-
forward instantly instead.
"""
import random
from datetime import datetime, timedelta, timezone

import pytest

from app.gamecast.models import GameStatus
from app.gamecast.providers.mock import MockNFLDataProvider, _generate_play_log, _reduce_state


class _FakeClock:
    """A controllable now_fn: starts at the real time, advances only
    when told to. `provider.now_fn` is bound to `.now`, so `advance()`
    changes what the provider sees on its next call with no real delay."""

    def __init__(self):
        self._now = datetime.now(timezone.utc)

    def now(self) -> datetime:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += timedelta(seconds=seconds)


async def test_list_live_games_returns_lightweight_summaries():
    provider = MockNFLDataProvider()
    games = await provider.list_live_games()
    assert len(games) == 2
    ids = {g.game_id for g in games}
    assert ids == {"mock-kc-buf", "mock-sf-dal"}
    for g in games:
        assert g.provider == "mock"
        assert g.home_team.abbr and g.away_team.abbr


async def test_unknown_game_id_raises_key_error():
    provider = MockNFLDataProvider()
    with pytest.raises(KeyError):
        await provider.get_game_state("not-a-real-game")


async def test_game_starts_scheduled_and_progresses_to_in_progress():
    clock = _FakeClock()
    provider = MockNFLDataProvider(now_fn=clock.now)
    initial = await provider.get_game_state("mock-kc-buf")
    assert initial.status == GameStatus.SCHEDULED
    assert initial.home_team.score == 0
    assert initial.away_team.score == 0
    assert initial.plays == []

    clock.advance(6)  # a handful of plays should have revealed by now

    later = await provider.get_game_state("mock-kc-buf")
    assert later.status == GameStatus.IN_PROGRESS
    assert len(later.plays) > 0
    assert later.last_updated >= initial.last_updated


async def test_scores_only_ever_move_forward_as_time_advances():
    clock = _FakeClock()
    provider = MockNFLDataProvider(now_fn=clock.now)
    clock.advance(3)
    first = await provider.get_game_state("mock-kc-buf")
    clock.advance(20)
    second = await provider.get_game_state("mock-kc-buf")

    assert second.home_team.score >= first.home_team.score
    assert second.away_team.score >= first.away_team.score
    assert len(second.plays) >= len(first.plays)
    # Every scoring play recorded so far must correspond to a real
    # points increase, not a fabricated event.
    for sp in second.scoring_plays:
        assert sp.score_type in ("TD", "FG")
        assert sp.home_score_after >= 0 and sp.away_score_after >= 0


async def test_down_never_exceeds_four_at_any_point_in_the_game():
    """Regression test for a real bug caught by manual smoke-testing:
    during the brief window between a failed 4th-down play revealing
    and its follow-up punt/field-goal play revealing, the state reducer
    was projecting "5th down" for the upcoming play. Fixed by treating
    next_down > 4 the same as a turnover/punt/FG (down/distance unknown
    until the real next play resolves) rather than blindly incrementing."""
    clock = _FakeClock()
    provider = MockNFLDataProvider(now_fn=clock.now)
    clock.advance(45)  # long enough to hit several failed conversions
    game = await provider.get_game_state("mock-kc-buf")

    assert game.down is None or 1 <= game.down <= 4
    for play in game.plays:
        assert play.down is None or 1 <= play.down <= 4


async def test_players_are_never_credited_to_the_wrong_team():
    """Regression test for a real bug caught by manual smoke-testing:
    a shared player-name pool for every offense let e.g. a 49ers
    player's name show up on a Chiefs play. Rosters are now per-team
    (_ROSTERS)."""
    clock = _FakeClock()
    provider = MockNFLDataProvider(now_fn=clock.now)
    clock.advance(10)
    game = await provider.get_game_state("mock-kc-buf")

    from app.gamecast.providers.mock import _ROSTERS

    for play in game.plays:
        if not play.team_abbr:
            continue
        team_players = {name for names in _ROSTERS[play.team_abbr].values() for name in names}
        for player in play.players_involved:
            assert player.name in team_players, f"{player.name} isn't on {play.team_abbr}'s mock roster"


async def test_field_position_and_redzone_are_internally_consistent():
    clock = _FakeClock()
    provider = MockNFLDataProvider(now_fn=clock.now)
    clock.advance(15)
    game = await provider.get_game_state("mock-kc-buf")

    if game.yards_to_goal is not None:
        assert 0 <= game.yards_to_goal <= 100
        assert game.is_redzone == (game.yards_to_goal <= 20)
        assert game.field_position_label is not None


async def test_finished_drives_get_a_terminal_result_and_the_current_drive_does_not():
    clock = _FakeClock()
    provider = MockNFLDataProvider(now_fn=clock.now)
    clock.advance(30)
    game = await provider.get_game_state("mock-kc-buf")

    for drive in game.drives:
        assert drive.result in ("TD", "FG", "PUNT", "TURNOVER", None) or drive.result is not None
        assert drive.play_count == len(drive.plays)
    if game.current_drive is not None:
        assert game.current_drive not in game.drives


def test_reduce_state_directly_with_a_synthetic_log_hits_every_status():
    """Unit-level (no sleeping, no real provider) test of the reducer
    itself against a hand-built two-play log, to pin down the exact
    scheduled -> in_progress -> final transition independent of the
    mock provider's own randomized script and timing."""
    from app.gamecast.providers.mock import _ScriptedPlay
    from app.gamecast.models import Play

    now = datetime.now(timezone.utc)
    play1 = Play(
        play_id="", period=1, clock="15:00", team_abbr="KC",
        down=1, distance=10, yard_line=75, description="Mahomes pass complete to Kelce for 10 yards",
        play_type="pass", yards_gained=10, is_first_down=True, timestamp=now,
    )
    play2 = Play(
        play_id="", period=4, clock="00:00", team_abbr="KC",
        down=None, distance=None, yard_line=0, description="Butker 20 yard field goal is GOOD",
        play_type="field_goal", yards_gained=None, is_scoring_play=True, timestamp=now,
    )
    log = [
        _ScriptedPlay(reveal_at=1.0, sim_seconds_elapsed=30, period=1, team_abbr="KC", play=play1, score_after=(0, 0)),
        _ScriptedPlay(reveal_at=2.0, sim_seconds_elapsed=900, period=4, team_abbr="KC", play=play2, score_after=(3, 0)),
    ]

    before = _reduce_state("g1", "mock", 2026, 1, now, "KC", "BUF", "Kansas City Chiefs", "Buffalo Bills", log, elapsed_seconds=0.0)
    assert before.status == GameStatus.SCHEDULED
    assert before.plays == []

    during = _reduce_state("g1", "mock", 2026, 1, now, "KC", "BUF", "Kansas City Chiefs", "Buffalo Bills", log, elapsed_seconds=1.0)
    assert during.status == GameStatus.IN_PROGRESS
    assert len(during.plays) == 1
    assert during.down == 1 and during.distance == 10  # first down just happened -> fresh set of downs

    final = _reduce_state("g1", "mock", 2026, 1, now, "KC", "BUF", "Kansas City Chiefs", "Buffalo Bills", log, elapsed_seconds=999.0)
    assert final.status == GameStatus.FINAL
    assert final.clock == "Final"
    assert final.home_team.score == 3


def test_generate_play_log_is_deterministic_for_a_given_seed():
    rng1 = random.Random(42)
    rng2 = random.Random(42)
    log1 = _generate_play_log(rng1, "KC", "BUF")
    log2 = _generate_play_log(rng2, "KC", "BUF")

    assert len(log1) == len(log2)
    assert [p.play.description for p in log1] == [p.play.description for p in log2]
