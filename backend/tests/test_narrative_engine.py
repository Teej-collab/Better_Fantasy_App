from app.config import DEFAULT_LEAGUE_ID
from app.domain import narrative_engine
from app.domain.narrative_engine import _resolve_kind, _resolve_weekly_kind
from tests.conftest import TEST_SEASON


def _mock_week_scoreboard(monkeypatch, status_by_week):
    """status_by_week: {week: "final" | "in_progress" | "not_started"}
    (a plain dict, not **kwargs — week numbers are ints, and keyword
    argument names have to be strings). Patches narrative_engine.
    get_week_scoreboard — the real ESPN public scoreboard call
    _week_completion now uses directly instead of league_state.
    current_week's own rollover (2026-09-15 fix: that rollover isn't a
    reliable "is this week actually over" signal — see narrative_
    engine's own module docstring) — with fake per-week game data
    matching each status. A week with no entry here returns no games at
    all, which _week_completion treats as "not_started"."""

    async def fake(week, year, season_type=2):
        status = status_by_week.get(week)
        if status == "final":
            return [{"completed": True, "state": "post"}]
        if status == "in_progress":
            return [{"completed": False, "state": "in"}]
        if status == "not_started":
            return [{"completed": False, "state": "pre"}]
        return []

    monkeypatch.setattr(narrative_engine, "get_week_scoreboard", fake)


async def _seed_two_teams_with_matchup(pool, suffix, week, home_score, away_score, season=TEST_SEASON):
    async with pool.acquire() as conn:
        owner_a = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-weekly-narrative-owner-a-{suffix}", "Home Owner",
        )
        owner_b = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-weekly-narrative-owner-b-{suffix}", "Away Owner",
        )
        team_a = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            season, 810000 + week, owner_a, f"Home Team {suffix}",
        )
        team_b = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            season, 820000 + week, owner_b, f"Away Team {suffix}",
        )
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, $2, $3, $4, $5, $6, FALSE)
            """,
            season, week, team_a, team_b, home_score, away_score,
        )
    return team_a, team_b


def _matchup(week=5, home_score=0.0, away_score=0.0):
    return {
        "matchup_id": 999,
        "season": TEST_SEASON,
        "week": week,
        "home": {"score": home_score},
        "away": {"score": away_score},
    }


async def test_resolve_kind_recap_once_the_week_is_actually_final(monkeypatch):
    _mock_week_scoreboard(monkeypatch, {5: "final"})
    assert await _resolve_kind(_matchup(week=5, home_score=110.0, away_score=90.0)) == "recap"


async def test_resolve_kind_preview_before_kickoff(monkeypatch):
    _mock_week_scoreboard(monkeypatch, {5: "not_started"})
    assert await _resolve_kind(_matchup(week=5)) == "preview"


async def test_resolve_kind_none_while_a_game_is_mid_week(monkeypatch):
    # Real, non-zero scores, but the week's own real games aren't all
    # final yet — deliberately not "recap" (see narrative_engine's
    # module docstring: generating one here would freeze an incomplete
    # result into the cache forever).
    _mock_week_scoreboard(monkeypatch, {5: "in_progress"})
    assert await _resolve_kind(_matchup(week=5, home_score=55.0, away_score=40.0)) is None


async def test_resolve_kind_none_when_no_real_schedule_data_and_already_started(monkeypatch):
    # Real scores, but no real game data at all to confirm the week is
    # actually over — can't safely call it a recap, and it's not 0-0
    # either, so nothing is eligible.
    _mock_week_scoreboard(monkeypatch, {})  # no entries -> no games -> "not_started"
    assert await _resolve_kind(_matchup(week=5, home_score=55.0, away_score=40.0)) is None


async def test_get_or_generate_narrative_caches_after_first_generation(pool, monkeypatch):
    _mock_week_scoreboard(monkeypatch, {5: "not_started"})
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
            "team_id": 999101, "owner_id": 999101,
            "team_name": "Team Alpha", "owner_name": "Alice", "record": "3-2", "streak": "neutral",
            "projected_total": 110.0, "score": 0, "clutch_choke": None, "bench_crime": None, "roster": [],
        },
        "away": {
            "team_id": 999102, "owner_id": 999102,
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

        # Week hasn't started (scores 0-0) -> "preview".
        first = await narrative_engine.get_or_generate_narrative(conn, matchup)
        second = await narrative_engine.get_or_generate_narrative(conn, matchup)

    assert first == "A real, on-brand write-up."
    assert second == "A real, on-brand write-up."
    # The second call must be a real cache hit — never a second API call.
    assert len(calls) == 1


async def test_get_or_generate_narrative_returns_none_without_a_real_api_key(pool, monkeypatch):
    _mock_week_scoreboard(monkeypatch, {5: "not_started"})
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


async def test_get_or_generate_narrative_includes_career_and_live_league_context(pool, monkeypatch):
    # Tuned 2026-09-02 per the owner's own ask ("pull from all
    # historical data, as well as what is live happening in the league
    # now") — confirms the facts string handed to the model actually
    # carries real career history (a past championship, or its real
    # absence) and real live context (a current Jeffrey's Rule chug
    # debt, a current league standings rank), not just this season's
    # record for the two teams in this one matchup.
    _mock_week_scoreboard(monkeypatch, {5: "not_started"})
    calls = []

    def fake_generate_narrative(system_prompt, facts, max_tokens=300):
        calls.append((system_prompt, facts))
        return "Real trash talk here."

    monkeypatch.setattr(narrative_engine, "generate_narrative", fake_generate_narrative)
    monkeypatch.setattr(narrative_engine, "ANTHROPIC_API_KEY", "fake-key-for-tests")

    async with pool.acquire() as conn:
        owner_champ = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-narrative-champ", "Champ Owner",
        )
        owner_scrub = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-narrative-scrub", "Scrub Owner",
        )
        team_champ = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 501, owner_champ, "Champ Team",
        )
        team_scrub = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 502, owner_scrub, "Scrub Team",
        )
        # Real career history: a past championship for owner_champ, none for owner_scrub.
        await conn.execute(
            "INSERT INTO season_champions (season, owner_id, team_name, league_id) VALUES ($1, $2, $3, $4)",
            TEST_SEASON - 1, owner_champ, "Champ Team", DEFAULT_LEAGUE_ID,
        )
        # Real, live chug debt for owner_scrub — and a real, explicit
        # zero-owed row for owner_champ (not just an absent row: no
        # chug_standing row at all means "we don't know," which is
        # different from "we know they're clean," and _chug_fact only
        # ever claims a clean record from a real zero-owed row).
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, outstanding_owed, league_id) VALUES ($1, $2, $3, $4)",
            TEST_SEASON, owner_scrub, 3, DEFAULT_LEAGUE_ID,
        )
        await conn.execute(
            "INSERT INTO chug_standing (season, owner_id, outstanding_owed, league_id) VALUES ($1, $2, $3, $4)",
            TEST_SEASON, owner_champ, 0, DEFAULT_LEAGUE_ID,
        )

        matchup = {
            "matchup_id": 999003,
            "season": TEST_SEASON,
            "week": 5,
            "league_id": DEFAULT_LEAGUE_ID,
            "is_playoff": False,
            "is_game_of_the_week": False,
            "rivalry": None,
            "head_to_head": {"wins_home": 0, "wins_away": 0, "ties": 0, "last_season": None, "last_week": None},
            "home": {
                "team_id": team_champ, "owner_id": owner_champ,
                "team_name": "Champ Team", "owner_name": "Champ Owner", "record": "5-0", "streak": "hot",
                "projected_total": 120.0, "score": 0, "clutch_choke": None, "bench_crime": None, "roster": [],
            },
            "away": {
                "team_id": team_scrub, "owner_id": owner_scrub,
                "team_name": "Scrub Team", "owner_name": "Scrub Owner", "record": "0-5", "streak": "cold",
                "projected_total": 80.0, "score": 0, "clutch_choke": None, "bench_crime": None, "roster": [],
            },
        }

        await conn.execute("DELETE FROM matchup_narratives WHERE matchup_id = $1", matchup["matchup_id"])
        result = await narrative_engine.get_or_generate_narrative(conn, matchup)

    assert result == "Real trash talk here."
    assert len(calls) == 1
    _, facts = calls[0]
    assert "Champ Team's owner has won the league championship in: " in facts
    assert "Scrub Team's owner has never won a league championship" in facts
    assert "Scrub Team's owner currently owes 3 under Jeffrey's Rule" in facts
    assert "Champ Team's owner has a clean Jeffrey's Rule chug record" in facts
    assert "is currently ranked" in facts


async def test_resolve_weekly_kind_recap_once_the_week_is_actually_final(monkeypatch):
    _mock_week_scoreboard(monkeypatch, {5: "final"})
    assert await _resolve_weekly_kind(TEST_SEASON, 5) == "recap"


async def test_resolve_weekly_kind_preview_for_a_week_that_has_not_started(monkeypatch):
    _mock_week_scoreboard(monkeypatch, {6: "not_started"})
    assert await _resolve_weekly_kind(TEST_SEASON, 6) == "preview"


async def test_resolve_weekly_kind_none_for_the_week_in_progress(monkeypatch):
    # Same "don't freeze an incomplete result into the cache" reasoning
    # as _resolve_kind's own mid-week case — a whole-week narrative for
    # the live week is doubly premature.
    _mock_week_scoreboard(monkeypatch, {5: "in_progress"})
    assert await _resolve_weekly_kind(TEST_SEASON, 5) is None


async def test_resolve_weekly_kind_preview_when_no_real_schedule_data_yet(monkeypatch):
    _mock_week_scoreboard(monkeypatch, {})  # no entries -> no games -> "not_started"
    assert await _resolve_weekly_kind(TEST_SEASON, 5) == "preview"


async def test_get_cached_weekly_narrative_returns_none_when_nothing_cached(pool, monkeypatch):
    _mock_week_scoreboard(monkeypatch, {5: "final"})
    async with pool.acquire() as conn:
        result = await narrative_engine.get_cached_weekly_narrative(conn, TEST_SEASON, 5, DEFAULT_LEAGUE_ID)
    assert result is None


async def test_get_cached_weekly_narrative_returns_text_and_kind_once_cached(pool, monkeypatch):
    _mock_week_scoreboard(monkeypatch, {5: "final"})
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO weekly_narratives (season, week, league_id, kind, text, model) "
            "VALUES ($1, $2, $3, 'recap', $4, 'test-model')",
            TEST_SEASON, 5, DEFAULT_LEAGUE_ID, "A real weekly recap.",
        )
        result = await narrative_engine.get_cached_weekly_narrative(conn, TEST_SEASON, 5, DEFAULT_LEAGUE_ID)
    assert result == {"text": "A real weekly recap.", "kind": "recap"}


async def test_generate_weekly_recap_returns_empty_for_a_week_with_no_matchups(pool):
    async with pool.acquire() as conn:
        result = await narrative_engine.generate_weekly_recap(conn, TEST_SEASON, 16, DEFAULT_LEAGUE_ID)
    assert result == {"weekly_narrative": None, "matchup_narratives": {}, "status": "no_matchups"}


async def test_generate_weekly_recap_fills_matchup_and_weekly_narratives_then_caches(pool, monkeypatch):
    week = 5
    _mock_week_scoreboard(monkeypatch, {week: "final"})  # week 5 is genuinely over — recap-eligible
    calls = []

    def fake_generate_narrative(system_prompt, facts, max_tokens=300):
        calls.append((system_prompt, facts, max_tokens))
        return f"Generated text #{len(calls)}"

    monkeypatch.setattr(narrative_engine, "generate_narrative", fake_generate_narrative)
    monkeypatch.setattr(narrative_engine, "ANTHROPIC_API_KEY", "fake-key-for-tests")

    team_a, team_b = await _seed_two_teams_with_matchup(
        pool, "fill", week, home_score=120.0, away_score=90.0
    )

    async with pool.acquire() as conn:
        matchup_id = await conn.fetchval(
            "SELECT id FROM matchups WHERE season = $1 AND week = $2 AND home_team_id = $3",
            TEST_SEASON, week, team_a,
        )

        first = await narrative_engine.generate_weekly_recap(conn, TEST_SEASON, week, DEFAULT_LEAGUE_ID)

    # One call for the single matchup's own recap, one for the whole-week recap.
    assert len(calls) == 2
    assert first["weekly_narrative"]["kind"] == "recap"
    assert first["weekly_narrative"]["text"] == "Generated text #2"
    assert first["matchup_narratives"] == {matchup_id: "Generated text #1"}
    # The weekly narrative gets a higher max_tokens budget than a per-matchup one.
    assert calls[1][2] == narrative_engine.WEEKLY_MAX_TOKENS

    async with pool.acquire() as conn:
        second = await narrative_engine.generate_weekly_recap(conn, TEST_SEASON, week, DEFAULT_LEAGUE_ID)
        cached = await narrative_engine.get_cached_weekly_narrative(conn, TEST_SEASON, week, DEFAULT_LEAGUE_ID)

    # Everything was already cached — no new API calls on the second run.
    assert len(calls) == 2
    assert second == first
    assert cached == first["weekly_narrative"]


async def test_generate_weekly_recap_preview_for_an_upcoming_week_includes_standings_context(pool, monkeypatch):
    week = 7
    _mock_week_scoreboard(monkeypatch, {week: "not_started"})  # week 7 hasn't started yet — preview-eligible
    calls = []

    def fake_generate_narrative(system_prompt, facts, max_tokens=300):
        calls.append((system_prompt, facts, max_tokens))
        return "A hyped-up preview."

    monkeypatch.setattr(narrative_engine, "generate_narrative", fake_generate_narrative)
    monkeypatch.setattr(narrative_engine, "ANTHROPIC_API_KEY", "fake-key-for-tests")

    await _seed_two_teams_with_matchup(pool, "preview", week, home_score=0.0, away_score=0.0)

    async with pool.acquire() as conn:
        result = await narrative_engine.generate_weekly_recap(conn, TEST_SEASON, week, DEFAULT_LEAGUE_ID)

    assert result["weekly_narrative"]["kind"] == "preview"
    assert calls[-1][0] == narrative_engine.WEEKLY_PREVIEW_PROMPT
    assert "League leader right now:" in calls[-1][1]


async def test_generate_weekly_recap_without_api_key_fills_nothing_new(pool, monkeypatch):
    week = 9
    _mock_week_scoreboard(monkeypatch, {week: "final"})
    monkeypatch.setattr(narrative_engine, "ANTHROPIC_API_KEY", None)

    await _seed_two_teams_with_matchup(pool, "nokey", week, home_score=100.0, away_score=80.0)

    async with pool.acquire() as conn:
        result = await narrative_engine.generate_weekly_recap(conn, TEST_SEASON, week, DEFAULT_LEAGUE_ID)

    assert result == {"weekly_narrative": None, "matchup_narratives": {}, "status": "not_configured"}


async def test_generate_weekly_recap_reports_not_eligible_while_the_week_is_still_live(pool, monkeypatch):
    """2026-09-15 real production bug: a commissioner hit "Generate This
    Week's Recap" for a week whose real NFL games had already gone
    final, but league_state.current_week (fed by ESPN's own public
    scoreboard week.number field) hadn't rolled over yet — so the old
    current_week-based eligibility check refused to generate anything
    and gave zero feedback. Fixed by checking the target week's own
    real game data directly (_week_completion) instead of that other,
    unreliable counter — this test now covers the genuinely-still-live
    case that check still correctly refuses."""
    _mock_week_scoreboard(monkeypatch, {11: "in_progress"})
    monkeypatch.setattr(narrative_engine, "generate_narrative", lambda *a, **k: "should never be called")
    monkeypatch.setattr(narrative_engine, "ANTHROPIC_API_KEY", "fake-key-for-tests")

    week = 11
    await _seed_two_teams_with_matchup(pool, "live", week, home_score=120.0, away_score=95.0)

    async with pool.acquire() as conn:
        result = await narrative_engine.generate_weekly_recap(conn, TEST_SEASON, week, DEFAULT_LEAGUE_ID)

    assert result["weekly_narrative"] is None
    assert result["status"] == "not_eligible"


async def test_generate_weekly_recap_becomes_eligible_from_real_completion_even_without_current_week(pool, monkeypatch):
    """The actual regression this whole fix is for: a week whose real
    games are all Final must be recap-eligible even when
    league_state.current_week (never touched in this test at all) has
    not rolled over past it."""
    week = 13
    _mock_week_scoreboard(monkeypatch, {week: "final"})
    monkeypatch.setattr(narrative_engine, "generate_narrative", lambda *a, **k: "Real recap text.")
    monkeypatch.setattr(narrative_engine, "ANTHROPIC_API_KEY", "fake-key-for-tests")

    await _seed_two_teams_with_matchup(pool, "no-current-week", week, home_score=88.0, away_score=77.0)

    async with pool.acquire() as conn:
        result = await narrative_engine.generate_weekly_recap(conn, TEST_SEASON, week, DEFAULT_LEAGUE_ID)

    assert result["status"] == "generated"
    assert result["weekly_narrative"] == {"text": "Real recap text.", "kind": "recap"}
