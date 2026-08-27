from app.domain import player_card


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


async def test_get_player_card_returns_none_for_unknown_player(pool):
    async with pool.acquire() as conn:
        card = await player_card.get_player_card(conn, "test-playercard-nonexistent")
    assert card is None


async def test_get_player_card_includes_bio_and_headshot(pool):
    await _seed_player(pool, "test-playercard-1", espn_id=None)

    async with pool.acquire() as conn:
        card = await player_card.get_player_card(conn, "test-playercard-1")

    assert card["full_name"] == "Test Player test-playercard-1"
    assert card["age"] == 25
    assert card["height"] == "73"
    assert card["weight"] == "202"
    assert card["jersey_number"] == "12"
    assert card["years_exp"] == 3
    assert card["headshot_url"] == "https://sleepercdn.com/content/nfl/players/test-playercard-1.jpg"
    assert card["projection"] is None  # no espn_player_id crosswalk


async def test_get_player_card_def_entry_has_no_headshot(pool):
    await _seed_player(pool, "test-playercard-dst", espn_id=None, position="DEF", pro_team="test-playercard-dst")

    async with pool.acquire() as conn:
        card = await player_card.get_player_card(conn, "test-playercard-dst")

    assert card["headshot_url"] is None


async def test_get_player_card_enriches_from_espn_when_crosswalk_exists(pool, monkeypatch):
    await _seed_player(pool, "test-playercard-2", espn_id=123456)
    monkeypatch.setattr(
        player_card, "get_player_info",
        lambda espn_player_id: {"season_projected_points": 200.0, "bye_week": 9} if espn_player_id == 123456 else None,
    )

    async with pool.acquire() as conn:
        card = await player_card.get_player_card(conn, "test-playercard-2")

    assert card["projection"] == {"season_projected_points": 200.0, "bye_week": 9}


async def test_get_player_card_degrades_gracefully_when_espn_call_fails(pool, monkeypatch):
    await _seed_player(pool, "test-playercard-3", espn_id=999999)

    def _raise(espn_player_id):
        raise RuntimeError("ESPN is down")

    monkeypatch.setattr(player_card, "get_player_info", _raise)

    async with pool.acquire() as conn:
        card = await player_card.get_player_card(conn, "test-playercard-3")

    assert card["full_name"] == "Test Player test-playercard-3"
    assert card["projection"] is None
