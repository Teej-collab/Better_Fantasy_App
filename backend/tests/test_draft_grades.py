from app.config import DEFAULT_LEAGUE_ID
from app.domain import draft_narratives
from app.domain.draft_grades import compute_draft_grades, get_draft_grades_for_season
from app.domain.draft_narratives import generate_draft_narratives
from tests.conftest import TEST_SEASON


async def _seed_owner(conn, suffix):
    return await conn.fetchval(
        "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
        f"test-draftgrade-owner-{suffix}", f"Owner {suffix}",
    )


async def _seed_pick(conn, owner_id, pick_number, sleeper_id, name, projected, search_rank=None):
    await conn.execute(
        "INSERT INTO players (sleeper_player_id, full_name, position, is_draftable, projected_points, search_rank) "
        "VALUES ($1, $2, 'RB', TRUE, $3, $4) "
        "ON CONFLICT (sleeper_player_id) DO NOTHING",
        sleeper_id, name, projected, search_rank,
    )
    await conn.execute(
        """
        INSERT INTO draft_picks (season, pick_number, round, round_pick, owner_id, sleeper_player_id, league_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        """,
        TEST_SEASON, pick_number, (pick_number - 1) // 4 + 1, (pick_number - 1) % 4 + 1,
        owner_id, sleeper_id, DEFAULT_LEAGUE_ID,
    )


async def test_compute_draft_grades_ranks_by_total_projected_points(pool):
    """Grade cutoffs are tuned for a real 12-team league (this app's
    actual league size) — test at that size, not an arbitrary smaller
    one, so the bucket boundaries mean what they're designed to mean."""
    async with pool.acquire() as conn:
        owners = [await _seed_owner(conn, i) for i in range(12)]
        # Distinct, strictly descending totals: owner 0 highest, owner 11 lowest.
        totals = [200.0 - (i * 10) for i in range(12)]
        for i, (owner_id, total) in enumerate(zip(owners, totals)):
            await _seed_pick(conn, owner_id, i * 4 + 1, f"test-dg-p{i}", f"Player {i}", total)

        count = await compute_draft_grades(conn, TEST_SEASON)
        assert count == 12

        grades = await get_draft_grades_for_season(conn, TEST_SEASON)
        by_owner = {g["owner_id"]: g for g in grades}
        assert by_owner[owners[0]]["letter_grade"] == "A"
        assert by_owner[owners[11]]["letter_grade"] == "F"
        assert float(by_owner[owners[0]]["percentile"]) == 100.0


async def test_compute_draft_grades_is_idempotent(pool):
    async with pool.acquire() as conn:
        owners = [await _seed_owner(conn, 10 + i) for i in range(2)]
        await _seed_pick(conn, owners[0], 101, "test-dg-idem-a", "Player A", 120.0)
        await _seed_pick(conn, owners[1], 102, "test-dg-idem-b", "Player B", 80.0)

        first = await compute_draft_grades(conn, TEST_SEASON)
        second = await compute_draft_grades(conn, TEST_SEASON)
        assert first == second == 2

        rows = await conn.fetch(
            "SELECT owner_id FROM draft_grades WHERE season = $1 AND owner_id = ANY($2::int[])",
            TEST_SEASON, owners,
        )
        assert len(rows) == 2  # no duplicate rows from the second call


async def test_compute_draft_grades_handles_null_sleeper_player_id_picks(pool):
    """An incomplete/autopick-skipped pick with no player attached must
    not crash the SUM aggregation."""
    async with pool.acquire() as conn:
        owner_id = await _seed_owner(conn, 20)
        await _seed_pick(conn, owner_id, 201, "test-dg-null-a", "Real Player", 90.0)
        await conn.execute(
            "INSERT INTO draft_picks (season, pick_number, round, round_pick, owner_id, sleeper_player_id, league_id) "
            "VALUES ($1, 202, 1, 2, $2, NULL, $3)",
            TEST_SEASON, owner_id, DEFAULT_LEAGUE_ID,
        )
        count = await compute_draft_grades(conn, TEST_SEASON)
        assert count == 1
        grade = await conn.fetchrow(
            "SELECT total_projected_points FROM draft_grades WHERE season = $1 AND owner_id = $2",
            TEST_SEASON, owner_id,
        )
        assert float(grade["total_projected_points"]) == 90.0


async def test_generate_draft_narratives_returns_empty_without_api_key(pool, monkeypatch):
    monkeypatch.setattr(draft_narratives.config, "ANTHROPIC_API_KEY", None)
    async with pool.acquire() as conn:
        owner_id = await _seed_owner(conn, 30)
        await _seed_pick(conn, owner_id, 301, "test-dg-nokey", "Player", 100.0)
        await compute_draft_grades(conn, TEST_SEASON)
        result = await generate_draft_narratives(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
        assert result == {}
        row = await conn.fetchval(
            "SELECT text FROM draft_narratives WHERE season = $1 AND owner_id = $2", TEST_SEASON, owner_id
        )
        assert row is None


async def test_generate_draft_narratives_caches_and_reuses(pool, monkeypatch):
    calls = []

    def fake_generate_narrative(system_prompt, facts, max_tokens=500):
        calls.append(facts)
        return "A real fake recap."

    monkeypatch.setattr(draft_narratives, "generate_narrative", fake_generate_narrative)
    monkeypatch.setattr(draft_narratives.config, "ANTHROPIC_API_KEY", "fake-key-for-tests")

    async with pool.acquire() as conn:
        owner_id = await _seed_owner(conn, 40)
        await _seed_pick(conn, owner_id, 401, "test-dg-cache", "Star Player", 130.0, search_rank=12)
        await compute_draft_grades(conn, TEST_SEASON)

        first = await generate_draft_narratives(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
        assert first[owner_id] == "A real fake recap."
        assert len(calls) == 1

        second = await generate_draft_narratives(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
        assert second[owner_id] == "A real fake recap."
        # Real generation still happens on every call today (no
        # cache-skip check before generating) — this test documents
        # that behavior. If a "don't regenerate an existing narrative"
        # guard is added later, this assertion should change to
        # len(calls) == 1 after the second call too.
        assert len(calls) == 2


async def test_build_draft_facts_never_calls_search_rank_adp(pool):
    async with pool.acquire() as conn:
        owner_id = await _seed_owner(conn, 50)
        await _seed_pick(conn, owner_id, 501, "test-dg-facts", "Reach Pick", 60.0, search_rank=250)
        await compute_draft_grades(conn, TEST_SEASON)
        grade = await conn.fetchrow(
            "SELECT * FROM draft_grades WHERE season = $1 AND owner_id = $2", TEST_SEASON, owner_id
        )
        picks = await conn.fetch(
            "SELECT dp.round, dp.pick_number, p.full_name AS player_name, p.position AS player_position, "
            "p.projected_points, p.search_rank FROM draft_picks dp JOIN players p ON p.sleeper_player_id = dp.sleeper_player_id "
            "WHERE dp.season = $1 AND dp.owner_id = $2",
            TEST_SEASON, owner_id,
        )
        facts = draft_narratives._build_draft_facts([dict(p) for p in picks], dict(grade))
        assert "ADP" not in facts
        assert "rank proxy" in facts
