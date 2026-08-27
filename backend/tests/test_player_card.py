from app.domain import player_card
from tests.conftest import TEST_SEASON


async def _seed_player(pool, sleeper_id, espn_id=None, position="RB", pro_team="KC"):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (
                sleeper_player_id, espn_player_id, full_name, position, fantasy_positions,
                pro_team, status, is_draftable, age, height, weight, jersey_number, years_exp
            )
            VALUES ($1, $2, $3, $4, $5, $6, 'Active', TRUE, $7, $8, $9, $10, $11)
            """,
            sleeper_id, espn_id, f"Test Player {sleeper_id}", position, [position],
            pro_team, 25, "73", "202", "12", 3,
        )


def _no_espn(monkeypatch):
    """No espn_player_id crosswalk AND no name match — the common case
    for a player that never got backfilled, without depending on a real
    (env-var-less, would-fail-anyway) network attempt to prove it."""
    monkeypatch.setattr(player_card, "get_player_info", lambda espn_player_id, full_name=None: None)


async def _no_overview(espn_player_id):
    return None


async def test_get_player_card_returns_none_for_unknown_player(pool):
    async with pool.acquire() as conn:
        card = await player_card.get_player_card(conn, "test-playercard-nonexistent")
    assert card is None


async def test_get_player_card_includes_bio_and_headshot(pool, monkeypatch):
    await _seed_player(pool, "test-playercard-1", espn_id=None)
    _no_espn(monkeypatch)

    async with pool.acquire() as conn:
        card = await player_card.get_player_card(conn, "test-playercard-1")

    assert card["full_name"] == "Test Player test-playercard-1"
    assert card["age"] == 25
    assert card["height"] == "73"
    assert card["weight"] == "202"
    assert card["jersey_number"] == "12"
    assert card["years_exp"] == 3
    assert card["headshot_url"] == "https://sleepercdn.com/content/nfl/players/test-playercard-1.jpg"
    assert card["projection"] is None
    assert card["latest_week"] is None


async def test_get_player_card_def_entry_has_no_headshot_and_skips_espn(pool, monkeypatch):
    await _seed_player(pool, "test-playercard-dst", espn_id=None, position="DEF", pro_team="test-playercard-dst")
    calls = []
    monkeypatch.setattr(player_card, "get_player_info", lambda *a, **kw: calls.append((a, kw)))

    async with pool.acquire() as conn:
        card = await player_card.get_player_card(conn, "test-playercard-dst")

    assert card["headshot_url"] is None
    assert card["projection"] is None
    assert calls == []  # never even attempted for a DEF entry


async def test_get_player_card_enriches_from_espn_when_crosswalk_exists(pool, monkeypatch):
    await _seed_player(pool, "test-playercard-2", espn_id=123456)
    monkeypatch.setattr(
        player_card, "get_player_info",
        lambda espn_player_id, full_name=None: (
            {"espn_player_id": 123456, "season_projected_points": 200.0, "bye_week": 9}
            if espn_player_id == 123456 else None
        ),
    )
    monkeypatch.setattr(player_card, "get_player_overview", _no_overview)

    async with pool.acquire() as conn:
        card = await player_card.get_player_card(conn, "test-playercard-2")

    assert card["projection"] == {"espn_player_id": 123456, "season_projected_points": 200.0, "bye_week": 9}
    assert card["espn_player_id"] == 123456


async def test_get_player_card_degrades_gracefully_when_espn_call_fails(pool, monkeypatch):
    await _seed_player(pool, "test-playercard-3", espn_id=999999)

    def _raise(espn_player_id, full_name=None):
        raise RuntimeError("ESPN is down")

    monkeypatch.setattr(player_card, "get_player_info", _raise)
    monkeypatch.setattr(player_card, "get_player_overview", _no_overview)

    async with pool.acquire() as conn:
        card = await player_card.get_player_card(conn, "test-playercard-3")

    assert card["full_name"] == "Test Player test-playercard-3"
    assert card["projection"] is None


async def test_get_player_card_degrades_gracefully_when_overview_call_fails(pool, monkeypatch):
    await _seed_player(pool, "test-playercard-3b", espn_id=999999)
    monkeypatch.setattr(player_card, "get_player_info", lambda espn_player_id, full_name=None: {"espn_player_id": 999999})

    async def _raise(espn_player_id):
        raise RuntimeError("ESPN is down")

    monkeypatch.setattr(player_card, "get_player_overview", _raise)

    async with pool.acquire() as conn:
        card = await player_card.get_player_card(conn, "test-playercard-3b")

    assert card["projection"] == {"espn_player_id": 999999}
    assert card["overview"] is None


async def test_get_player_card_includes_overview_when_available(pool, monkeypatch):
    await _seed_player(pool, "test-playercard-3c", espn_id=999999)
    monkeypatch.setattr(player_card, "get_player_info", lambda espn_player_id, full_name=None: {"espn_player_id": 999999})

    async def _fake_overview(espn_player_id):
        return {"news": [{"headline": "Test news"}], "draft_rank": 3, "season_outlook": "Looking good."}

    monkeypatch.setattr(player_card, "get_player_overview", _fake_overview)

    async with pool.acquire() as conn:
        card = await player_card.get_player_card(conn, "test-playercard-3c")

    assert card["overview"]["draft_rank"] == 3
    assert card["overview"]["season_outlook"] == "Looking good."


async def test_get_player_card_backfills_espn_id_resolved_by_name(pool, monkeypatch):
    await _seed_player(pool, "test-playercard-4", espn_id=None)
    monkeypatch.setattr(
        player_card, "get_player_info",
        lambda espn_player_id, full_name=None: (
            {"espn_player_id": 777777, "season_projected_points": 150.0}
            if espn_player_id is None and full_name == "Test Player test-playercard-4" else None
        ),
    )
    monkeypatch.setattr(player_card, "get_player_overview", _no_overview)

    async with pool.acquire() as conn:
        card = await player_card.get_player_card(conn, "test-playercard-4")
        row = await conn.fetchrow("SELECT espn_player_id FROM players WHERE sleeper_player_id = $1", "test-playercard-4")

    assert card["espn_player_id"] == 777777
    assert card["projection"]["season_projected_points"] == 150.0
    assert row["espn_player_id"] == 777777  # persisted for next time


async def test_get_player_card_includes_latest_computed_week(pool, monkeypatch):
    await _seed_player(pool, "test-playercard-5", espn_id=None)
    _no_espn(monkeypatch)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, 1, $2, '{}', 12.5), ($1, 2, $2, '{}', 18.0)",
            TEST_SEASON, "test-playercard-5",
        )
        card = await player_card.get_player_card(conn, "test-playercard-5")

    assert card["latest_week"]["week"] == 2
    assert float(card["latest_week"]["fantasy_points"]) == 18.0
