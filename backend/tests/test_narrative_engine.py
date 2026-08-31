from app.domain import narrative_engine
from app.domain.narrative_engine import _resolve_kind
from tests.conftest import TEST_SEASON


def _matchup(week=5, home_score=0.0, away_score=0.0):
    return {
        "matchup_id": 999,
        "season": TEST_SEASON,
        "week": week,
        "home": {"score": home_score},
        "away": {"score": away_score},
    }


def test_resolve_kind_recap_once_league_has_moved_past_the_week():
    assert _resolve_kind(_matchup(week=5, home_score=110.0, away_score=90.0), current_week=6) == "recap"


def test_resolve_kind_preview_before_kickoff():
    assert _resolve_kind(_matchup(week=5), current_week=5) == "preview"


def test_resolve_kind_none_while_a_game_is_mid_week():
    # Real, non-zero scores, but the league hasn't moved past this week
    # yet — deliberately not "recap" (see narrative_engine's module
    # docstring: generating one here would freeze an incomplete result
    # into the cache forever).
    assert _resolve_kind(_matchup(week=5, home_score=55.0, away_score=40.0), current_week=5) is None


def test_resolve_kind_none_when_current_week_unknown_and_already_started():
    # Real scores, but no cached current-week signal to confirm the
    # league has actually moved past this matchup yet — can't safely
    # call it a recap, and it's not 0-0 either, so nothing is eligible.
    assert _resolve_kind(_matchup(week=5, home_score=55.0, away_score=40.0), current_week=None) is None


async def test_get_or_generate_narrative_caches_after_first_generation(pool, monkeypatch):
    calls = []

    def fake_generate_narrative(system_prompt, facts, max_tokens=300):
        calls.append((system_prompt, facts))
        return "A real, on-brand write-up."

    monkeypatch.setattr(narrative_engine, "generate_narrative", fake_generate_narrative)
    monkeypatch.setattr(narrative_engine, "ANTHROPIC_API_KEY", "fake-key-for-tests")

    matchup = {
        "matchup_id": 999001,
        "season": TEST_SEASON,
        "week": 5,
        "is_playoff": False,
        "is_game_of_the_week": False,
        "rivalry": None,
        "head_to_head": {"wins_home": 0, "wins_away": 0, "ties": 0, "last_season": None, "last_week": None},
        "home": {
            "team_name": "Team Alpha", "owner_name": "Alice", "record": "3-2", "streak": "neutral",
            "projected_total": 110.0, "score": 0, "clutch_choke": None, "bench_crime": None, "roster": [],
        },
        "away": {
            "team_name": "Team Beta", "owner_name": "Bob", "record": "2-3", "streak": "hot",
            "projected_total": 105.0, "score": 0, "clutch_choke": None, "bench_crime": None, "roster": [],
        },
    }

    async with pool.acquire() as conn:
        # matchup_narratives isn't covered by conftest's TEST_SEASON
        # cleanup (it's keyed by matchup_id, not season) — clear any
        # row a previous run of this exact test left behind, so the
        # cache-hit assertion below is actually testing this run's
        # first-call-generates behavior, not a stale row from last time.
        await conn.execute("DELETE FROM matchup_narratives WHERE matchup_id = $1", matchup["matchup_id"])

        # current_week == matchup week and scores are 0-0 → "preview".
        first = await narrative_engine.get_or_generate_narrative(conn, matchup)
        second = await narrative_engine.get_or_generate_narrative(conn, matchup)

    assert first == "A real, on-brand write-up."
    assert second == "A real, on-brand write-up."
    # The second call must be a real cache hit — never a second API call.
    assert len(calls) == 1


async def test_get_or_generate_narrative_returns_none_without_a_real_api_key(pool, monkeypatch):
    monkeypatch.setattr(narrative_engine, "ANTHROPIC_API_KEY", None)

    matchup = {
        "matchup_id": 999002,
        "season": TEST_SEASON,
        "week": 5,
        "is_playoff": False,
        "is_game_of_the_week": False,
        "rivalry": None,
        "head_to_head": {"wins_home": 0, "wins_away": 0, "ties": 0, "last_season": None, "last_week": None},
        "home": {
            "team_name": "Team Alpha", "owner_name": "Alice", "record": "0-0", "streak": "neutral",
            "projected_total": 100.0, "score": 0, "clutch_choke": None, "bench_crime": None, "roster": [],
        },
        "away": {
            "team_name": "Team Beta", "owner_name": "Bob", "record": "0-0", "streak": "neutral",
            "projected_total": 95.0, "score": 0, "clutch_choke": None, "bench_crime": None, "roster": [],
        },
    }

    async with pool.acquire() as conn:
        result = await narrative_engine.get_or_generate_narrative(conn, matchup)

    assert result is None
