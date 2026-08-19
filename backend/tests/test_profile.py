from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.conftest import TEST_SEASON


async def _get(path):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


async def _seed_owner_and_team(pool, suffix, display_name, team_name, season=TEST_SEASON):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-profile-owner-{suffix}", display_name,
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            season, 200 + suffix, owner_id, team_name,
        )
    return owner_id, team_id


async def test_season_profile_splits_regular_and_playoff(pool):
    owner_a, team_a = await _seed_owner_and_team(pool, 1, "Alice", "Team Alpha")
    _, team_b = await _seed_owner_and_team(pool, 2, "Bob", "Team Beta")

    async with pool.acquire() as conn:
        # regular season: 1 win
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 1, $2, $3, 120.0, 100.0, FALSE)",
            TEST_SEASON, team_a, team_b,
        )
        # regular season: 1 loss
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 2, $2, $3, 90.0, 110.0, FALSE)",
            TEST_SEASON, team_a, team_b,
        )
        # playoff win — should NOT affect the "regular" bucket
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 15, $2, $3, 130.0, 100.0, TRUE)",
            TEST_SEASON, team_a, team_b,
        )

    resp = await _get(f"/owners/{owner_a}/profile?season={TEST_SEASON}")
    assert resp.status_code == 200
    body = resp.json()

    assert body["regular"]["record"] == "1-1"
    assert body["regular"]["pf"] == 210.0
    assert body["playoff"]["record"] == "1-0"
    assert body["playoff"]["pf"] == 130.0
    assert body["best_week"] == {"week": 1, "score": 120.0}
    assert body["worst_week"] == {"week": 2, "score": 90.0}


async def test_season_profile_404_for_owner_with_no_team(pool):
    resp = await _get(f"/owners/999999999/profile?season={TEST_SEASON}")
    assert resp.status_code == 404


async def test_season_profile_includes_season_awards(pool):
    owner_a, team_a = await _seed_owner_and_team(pool, 6, "Faye", "Faye's Team")
    _, team_b = await _seed_owner_and_team(pool, 7, "Gus", "Gus's Team")

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 1, $2, $3, 120.0, 100.0, FALSE)",
            TEST_SEASON, team_a, team_b,
        )
        await conn.execute(
            "INSERT INTO season_awards (season, owner_id, award_type, detail) VALUES ($1, $2, 'Boom Week', '120.0 pts')",
            TEST_SEASON, owner_a,
        )
        # A different season's award for the same owner should NOT show up.
        await conn.execute(
            "INSERT INTO season_awards (season, owner_id, award_type, detail) VALUES (2019, $1, 'Old Award', 'irrelevant')",
            owner_a,
        )

    resp = await _get(f"/owners/{owner_a}/profile?season={TEST_SEASON}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["season_awards"] == [{"award_type": "Boom Week", "detail": "120.0 pts"}]

    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM season_awards WHERE season = 2019 AND owner_id = $1", owner_a)


async def test_career_profile_aggregates_across_seasons(pool):
    owner_a, team_a_2023 = await _seed_owner_and_team(pool, 3, "Carl", "Carl's 2023 Team", season=2023)
    async with pool.acquire() as conn:
        team_a_2024 = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES (2024, 203, $1, 'Carl 2024') RETURNING id",
            owner_a,
        )
        opp_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ('test-profile-owner-opp', 'Opp') RETURNING owner_id",
        )
        opp_team_2023 = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES (2023, 210, $1, 'Opp 2023') RETURNING id",
            opp_id,
        )
        opp_team_2024 = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES (2024, 211, $1, 'Opp 2024') RETURNING id",
            opp_id,
        )
        # 2023: win
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES (2023, 1, $1, $2, 100.0, 90.0, FALSE)",
            team_a_2023, opp_team_2023,
        )
        # 2024: loss
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES (2024, 1, $1, $2, 80.0, 95.0, FALSE)",
            team_a_2024, opp_team_2024,
        )
        cleanup_ids = [team_a_2023, team_a_2024, opp_team_2023, opp_team_2024]

    resp = await _get(f"/owners/{owner_a}/career")
    assert resp.status_code == 200
    body = resp.json()
    assert body["seasons"] == [2023, 2024]
    assert body["regular"]["record"] == "1-1"
    assert body["best_season"]["season"] == 2023
    assert body["worst_season"]["season"] == 2024

    # manual cleanup — these seasons aren't TEST_SEASON, so the autouse
    # fixture's season-scoped cleanup won't catch them
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM matchups WHERE home_team_id = ANY($1) OR away_team_id = ANY($1)", cleanup_ids)
        await conn.execute("DELETE FROM teams_by_season WHERE id = ANY($1)", cleanup_ids)
        await conn.execute("DELETE FROM owners WHERE espn_member_id = 'test-profile-owner-opp'")


async def test_owner_badges_groups_awards_by_type(pool):
    owner_a, _ = await _seed_owner_and_team(pool, 4, "Dana", "Dana's Team")

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO season_champions (season, owner_id, team_name) VALUES ($1, $2, 'Dana Champs')",
            TEST_SEASON, owner_a,
        )
        await conn.execute(
            "INSERT INTO season_awards (season, owner_id, award_type, detail) VALUES ($1, $2, 'Clutch Performer', '4 clutch weeks')",
            TEST_SEASON, owner_a,
        )

    resp = await _get(f"/owners/{owner_a}/badges")
    assert resp.status_code == 200
    body = resp.json()
    assert body["championship_years"] == [TEST_SEASON]
    assert body["award_summary"] == {"Clutch Performer": [TEST_SEASON]}


async def test_list_all_owners_not_scoped_to_one_season(pool):
    # Explicit requirement: the owner-card grid includes everyone who's
    # ever been in the league, not just current-season teams — so an
    # owner whose only team was in an old season must still show up.
    owner_id, team_2023 = await _seed_owner_and_team(pool, 5, "Erin", "Erin 2023 Squad", season=2023)
    async with pool.acquire() as conn:
        team_2025 = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES (2025, 305, $1, 'Erin 2025 Squad') RETURNING id",
            owner_id,
        )
        cleanup_ids = [team_2023, team_2025]

    resp = await _get("/owners")
    assert resp.status_code == 200
    owners_by_id = {o["owner_id"]: o for o in resp.json()["owners"]}

    assert owner_id in owners_by_id
    entry = owners_by_id[owner_id]
    assert entry["display_name"] == "Erin"
    assert entry["latest_team_name"] == "Erin 2025 Squad"  # most recent season, not first
    assert entry["seasons"] == [2023, 2025]

    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM teams_by_season WHERE id = ANY($1)", cleanup_ids)
