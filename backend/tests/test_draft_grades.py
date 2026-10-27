from app.config import DEFAULT_LEAGUE_ID
from app.domain import draft_narratives
from app.domain.draft_grades import (
    BENCH_WEIGHT,
    compute_draft_grades,
    get_draft_grades_for_season,
    replacement_levels,
    rounds_gained,
    score_roster,
    value_board,
)
from app.domain.draft_narratives import generate_draft_narratives
from tests.conftest import TEST_SEASON


async def _seed_owner(conn, suffix):
    return await conn.fetchval(
        "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
        f"test-draftgrade-owner-{suffix}", f"Owner {suffix}",
    )


async def _seed_pick(conn, owner_id, pick_number, sleeper_id, name, projected, search_rank=None, is_keeper=False):
    await conn.execute(
        "INSERT INTO players (sleeper_player_id, full_name, position, is_draftable, projected_points, search_rank) "
        "VALUES ($1, $2, 'RB', TRUE, $3, $4) "
        "ON CONFLICT (sleeper_player_id) DO NOTHING",
        sleeper_id, name, projected, search_rank,
    )
    await conn.execute(
        """
        INSERT INTO draft_picks (season, pick_number, round, round_pick, owner_id, sleeper_player_id, league_id, is_keeper)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        TEST_SEASON, pick_number, (pick_number - 1) // 4 + 1, (pick_number - 1) % 4 + 1,
        owner_id, sleeper_id, DEFAULT_LEAGUE_ID, is_keeper,
    )


async def test_compute_draft_grades_ranks_by_lineup_value(pool):
    """Grade cutoffs are tuned for a real 12-team league (this app's
    actual league size) — test at that size, not an arbitrary smaller
    one, so the bucket boundaries mean what they're designed to mean.
    One RB each, so the lineup value is just that RB's projection."""
    async with pool.acquire() as conn:
        # Players seeded by earlier runs linger and would set a
        # replacement level; this test wants none.
        await conn.execute("UPDATE players SET is_draftable = FALSE WHERE sleeper_player_id LIKE 'test-%'")
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


def test_draft_facts_give_plain_labels_not_the_math():
    """The grade comes from the numbers; the write-up only gets plain
    steal/reach labels and a lineup standing, never ADP, ranks, rounds
    or percentiles to quote (owner request, 2026-10-27)."""
    picks = [
        {"round": 1, "player_name": "Early Guy", "player_position": "RB", "is_keeper": False, "label": "a big steal"},
        {"round": 2, "player_name": "Reach Guy", "player_position": "QB", "is_keeper": False, "label": "a reach"},
        {"round": 3, "player_name": "Fair Guy", "player_position": "QB", "is_keeper": False, "label": None},
        {"round": 4, "player_name": "Kept Guy", "player_position": "WR", "is_keeper": True, "label": "a big steal"},
    ]
    grade = {
        "letter_grade": "B", "percentile": 66.7, "starter_projected_points": 1300,
        "league_avg_starter_projected_points": 1200, "pick_value_rounds": 0.9,
    }
    facts = draft_narratives._build_draft_facts(picks, grade)
    assert "Round 1: Early Guy (RB) — a big steal" in facts
    assert "Round 2: Reach Guy (QB) — a reach" in facts
    assert "Round 3: Fair Guy (QB);" in facts
    assert "Kept Guy (WR) — KEEPER" in facts and "Kept Guy (WR) — a" not in facts
    assert "2 QB" in facts
    assert "one of the strongest starting lineups" in facts
    for analyst_word in ("ADP", "rank", "rounds", "percentile", "1300", "66"):
        assert analyst_word not in facts


async def test_generate_draft_narratives_flags_keeper_picks_in_the_real_facts_sent(pool, monkeypatch):
    """Real production bug (2026-09): a keeper pick was praised as a
    draft-day "steal" because generate_draft_narratives's own SQL never
    selected dp.is_keeper at all, so _build_draft_facts's keeper check
    always saw None regardless of the real flag. This exercises the
    FULL pipeline (the SQL, not just the facts-builder in isolation) so
    a regression there is actually caught."""
    captured_facts = {}

    def fake_generate_narrative(system_prompt, facts, max_tokens=500):
        captured_facts["value"] = facts
        return "recap"

    monkeypatch.setattr(draft_narratives, "generate_narrative", fake_generate_narrative)
    monkeypatch.setattr(draft_narratives.config, "ANTHROPIC_API_KEY", "fake-key-for-tests")

    async with pool.acquire() as conn:
        owner_id = await _seed_owner(conn, 60)
        await _seed_pick(conn, owner_id, 601, "test-dg-keeper", "Kept Player", 200.0, is_keeper=True)
        await compute_draft_grades(conn, TEST_SEASON)
        await generate_draft_narratives(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)

    assert "KEEPER" in captured_facts["value"]
    assert "Kept Player" in captured_facts["value"]


# A 1-QB league (DEFAULT_ROSTER_SLOTS shape). Replacement levels a
# little under a typical waiver pickup at each position.
_SLOTS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 7}
_REPLACEMENT = {"QB": 280.0, "RB": 120.0, "WR": 130.0, "TE": 90.0, "K": 120.0, "DEF": 100.0}
# Real production complaint (2026-10): Jeff drafted four QBs and graded
# near the top, because QBs carry the biggest projections and the old
# grade summed every drafted player.
_FOUR_QBS = [
    ("QB", 380.0), ("QB", 360.0), ("QB", 350.0), ("QB", 340.0),
    ("RB", 200.0), ("RB", 150.0), ("WR", 210.0), ("WR", 160.0),
    ("TE", 110.0), ("K", 140.0), ("DEF", 120.0),
]
_BALANCED = [
    ("QB", 370.0), ("RB", 280.0), ("RB", 250.0), ("RB", 180.0),
    ("WR", 290.0), ("WR", 260.0), ("WR", 200.0),
    ("TE", 180.0), ("K", 140.0), ("DEF", 120.0),
]


def test_four_qb_draft_scores_below_a_balanced_one_despite_more_total_points():
    assert sum(p for _, p in _FOUR_QBS) > sum(p for _, p in _BALANCED)
    _, four_qb_value = score_roster(_FOUR_QBS, _SLOTS, _REPLACEMENT)
    _, balanced_value = score_roster(_BALANCED, _SLOTS, _REPLACEMENT)
    assert balanced_value > four_qb_value * 2


def test_only_one_backup_per_starter_counts_and_none_for_k_or_def():
    base = [("QB", 380.0), ("K", 140.0)]
    slots = {"QB": 1, "K": 1}
    _, alone = score_roster(base, slots, _REPLACEMENT)
    _, one_backup = score_roster([*base, ("QB", 360.0)], slots, _REPLACEMENT)
    _, two_backups = score_roster([*base, ("QB", 360.0), ("QB", 350.0)], slots, _REPLACEMENT)
    _, backup_k = score_roster([*base, ("K", 139.0)], slots, _REPLACEMENT)
    assert one_backup == alone + BENCH_WEIGHT * 80.0
    assert two_backups == one_backup
    assert backup_k == alone


def test_flex_uses_the_best_leftover_and_unfilled_slots_score_zero():
    starters, value = score_roster([("RB", 200.0), ("WR", 230.0)], {"RB": 1, "RB/WR/TE": 1, "TE": 1}, _REPLACEMENT)
    assert starters == 430.0  # the WR filled the flex; the TE slot sat empty
    assert value == 80.0 + 100.0


def test_replacement_level_averages_the_best_few_undrafted():
    levels = replacement_levels([("QB", 300.0), ("QB", 290.0), ("QB", 280.0), ("QB", 100.0), ("DE", 80.0)])
    assert levels["QB"] == 290.0
    assert levels["DL"] == 80.0  # defenders fold into their IDP group


async def test_compute_draft_grades_four_qbs_grade_below_balanced(pool):
    """Full pipeline: replacement levels from real undrafted players,
    the default roster shape, and the stored starter numbers."""
    async with pool.acquire() as conn:
        await conn.execute("UPDATE players SET is_draftable = FALSE WHERE sleeper_player_id LIKE 'test-%'")
        try:
            for position, level in _REPLACEMENT.items():
                for n in range(3):
                    await conn.execute(
                        "INSERT INTO players (sleeper_player_id, full_name, position, is_draftable, projected_points) "
                        "VALUES ($1, $2, $3, TRUE, $4)",
                        f"test-dg-repl-{position}-{n}", f"Waiver {position} {n}", position, level + 1 - n,
                    )
            jeff, balanced = await _seed_owner(conn, 70), await _seed_owner(conn, 71)
            pick = 700
            for owner_id, roster in ((jeff, _FOUR_QBS), (balanced, _BALANCED)):
                for position, projected in roster:
                    pick += 1
                    await conn.execute(
                        "INSERT INTO players (sleeper_player_id, full_name, position, is_draftable, projected_points) "
                        "VALUES ($1, $2, $3, TRUE, $4)",
                        f"test-dg-repl-pick-{pick}", f"Pick {pick}", position, projected,
                    )
                    await conn.execute(
                        "INSERT INTO draft_picks (season, pick_number, round, round_pick, owner_id, sleeper_player_id, league_id) "
                        "VALUES ($1, $2, 1, 1, $3, $4, $5)",
                        TEST_SEASON, pick, owner_id, f"test-dg-repl-pick-{pick}", DEFAULT_LEAGUE_ID,
                    )

            assert await compute_draft_grades(conn, TEST_SEASON) == 2
            by_owner = {g["owner_id"]: g for g in await get_draft_grades_for_season(conn, TEST_SEASON)}
            assert by_owner[jeff]["total_projected_points"] > by_owner[balanced]["total_projected_points"]
            assert by_owner[balanced]["letter_grade"] == "A"
            assert by_owner[jeff]["letter_grade"] == "C"
            # Jeff starts one QB; the flex sat empty with no third RB or WR.
            assert float(by_owner[jeff]["starter_projected_points"]) == 380 + 200 + 150 + 210 + 160 + 110 + 140 + 120
        finally:
            await conn.execute("DELETE FROM draft_picks WHERE sleeper_player_id LIKE 'test-dg-repl-%'")
            await conn.execute("DELETE FROM players WHERE sleeper_player_id LIKE 'test-dg-repl-%'")


def test_value_board_ranks_by_value_over_waivers_not_raw_projection():
    board = value_board([("qb", "QB", 380.0), ("rb", "RB", 260.0)], _REPLACEMENT)
    assert board == {"rb": 1, "qb": 2}  # 140 over waivers beats the QB's 100


def test_rounds_gained_is_capped_both_ways():
    assert rounds_gained(25, 1, 12) == 2.0  # went two rounds after his rank: a steal
    assert rounds_gained(1, 13, 12) == -1.0
    assert rounds_gained(200, 1, 12) == 3.0
    assert rounds_gained(1, 200, 12) == -3.0


async def _seed_two_team_draft(conn, owners, price=None):
    """Owner 0 takes the second-best RB first overall (a reach); owner 1
    gets the best RB second (a steal)."""
    await conn.execute("UPDATE players SET is_draftable = FALSE WHERE sleeper_player_id LIKE 'test-%'")
    for n, (owner_id, projected) in enumerate(zip(owners, (200.0, 300.0)), start=1):
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, is_draftable, projected_points) "
            "VALUES ($1, $2, 'RB', TRUE, $3)",
            f"test-dg-pv-{n}", f"Value RB {n}", projected,
        )
        await conn.execute(
            "INSERT INTO draft_picks (season, pick_number, round, round_pick, owner_id, sleeper_player_id, league_id, price) "
            "VALUES ($1, $2, 1, $2, $3, $4, $5, $6)",
            TEST_SEASON, n, owner_id, f"test-dg-pv-{n}", DEFAULT_LEAGUE_ID, price,
        )


async def test_compute_draft_grades_stores_pick_value_by_sign(pool):
    async with pool.acquire() as conn:
        owners = [await _seed_owner(conn, 80 + i) for i in range(2)]
        try:
            await _seed_two_team_draft(conn, owners)
            await compute_draft_grades(conn, TEST_SEASON)
            by_owner = {g["owner_id"]: g for g in await get_draft_grades_for_season(conn, TEST_SEASON)}
            assert float(by_owner[owners[0]]["pick_value_rounds"]) == -0.5
            assert float(by_owner[owners[1]]["pick_value_rounds"]) == 0.5
        finally:
            await conn.execute("DELETE FROM draft_picks WHERE sleeper_player_id LIKE 'test-dg-pv-%'")
            await conn.execute("DELETE FROM players WHERE sleeper_player_id LIKE 'test-dg-pv-%'")


async def test_compute_draft_grades_skips_pick_value_for_an_auction(pool):
    async with pool.acquire() as conn:
        owners = [await _seed_owner(conn, 90 + i) for i in range(2)]
        try:
            await _seed_two_team_draft(conn, owners, price=40)
            await compute_draft_grades(conn, TEST_SEASON)
            grades = await get_draft_grades_for_season(conn, TEST_SEASON)
            assert all(g["pick_value_rounds"] is None for g in grades)
        finally:
            await conn.execute("DELETE FROM draft_picks WHERE sleeper_player_id LIKE 'test-dg-pv-%'")
            await conn.execute("DELETE FROM players WHERE sleeper_player_id LIKE 'test-dg-pv-%'")


def test_pick_labels_only_call_out_the_ends_of_the_room():
    gains = {f"p{i}": float(i - 10) for i in range(21)}  # -10 .. +10
    gains["k"] = 9.5
    positions = {"k": "K"}
    labels = draft_narratives.pick_labels(gains, positions)
    assert labels["p20"] == "a big steal" and labels["p0"] == "a big reach"
    assert labels["p18"] == "a steal" and labels["p2"] == "a reach"
    assert "p10" not in labels and "p15" not in labels
    assert "k" not in labels  # kickers and defenses never get one
