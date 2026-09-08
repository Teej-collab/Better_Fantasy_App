from httpx import ASGITransport, AsyncClient

from app.main import app


def _client(base_url="http://test"):
    return AsyncClient(transport=ASGITransport(app=app), base_url=base_url)


async def _sign_up(client: AsyncClient, email: str, display_name: str = "Test Person"):
    resp = await client.post(
        "/auth/signup", json={"email": email, "password": "correct-horse", "display_name": display_name}
    )
    assert resp.status_code == 200


async def test_get_scoring_rules_requires_session():
    async with _client() as client:
        resp = await client.get("/league/scoring-rules")
    assert resp.status_code == 401


async def test_new_league_has_real_scoring_rules_seeded(pool):
    """POST /leagues seeds a new league's scoring rules from League #1's
    real values (seed_default_scoring_rules) — confirms there's
    actually something for GET /league/scoring-rules to read."""
    async with _client() as client:
        await _sign_up(client, "test-scoring-seeded@example.com")
        await client.post("/leagues", json={"name": "Test League Scoring Seeded"})
        resp = await client.get("/league/scoring-rules")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["rules"]) > 0
    categories = {r["stat_category"] for r in body["rules"]}
    assert "pass_td" in categories


async def test_commissioner_can_update_scoring_rules(pool):
    async with _client() as client:
        await _sign_up(client, "test-scoring-update@example.com")
        created = await client.post("/leagues", json={"name": "Test League Scoring Update"})
        season = None
        rules_resp = await client.get("/league/scoring-rules")
        season = rules_resp.json()["season"]

        put_resp = await client.put(
            "/league/scoring-rules", json={"season": season, "rules": {"pass_td": 6.0, "rush_td": 7.0}}
        )
        assert put_resp.status_code == 200

        get_resp = await client.get("/league/scoring-rules")
    rules = {r["stat_category"]: r["points_per_unit"] for r in get_resp.json()["rules"]}
    assert rules["pass_td"] == 6.0
    assert rules["rush_td"] == 7.0
    assert created.json()["name"] == "Test League Scoring Update"


async def test_non_commissioner_cannot_update_scoring_rules(pool):
    async with _client() as creator:
        await _sign_up(creator, "test-scoring-unauth-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Scoring Unauth"})
        invite_code = created.json()["invite_code"]
        season = (await creator.get("/league/scoring-rules")).json()["season"]

    async with _client() as member:
        await _sign_up(member, "test-scoring-unauth-member@example.com")
        await member.post("/leagues/join", json={"invite_code": invite_code})
        resp = await member.put("/league/scoring-rules", json={"season": season, "rules": {"pass_td": 99.0}})
    assert resp.status_code == 403


async def test_get_playoff_settings_requires_session():
    async with _client() as client:
        resp = await client.get("/league/playoff-settings")
    assert resp.status_code == 401


async def test_playoff_settings_null_when_nothing_set(pool):
    async with _client() as client:
        await _sign_up(client, "test-playoff-none@example.com")
        await client.post("/leagues", json={"name": "Test League Playoff None"})
        resp = await client.get("/league/playoff-settings")
    assert resp.status_code == 200
    assert resp.json()["playoff_team_count"] is None


async def test_commissioner_can_set_playoff_team_count(pool):
    async with _client() as client:
        await _sign_up(client, "test-playoff-set@example.com")
        await client.post("/leagues", json={"name": "Test League Playoff Set"})
        season = (await client.get("/league/playoff-settings")).json()["season"]

        put_resp = await client.put(
            "/league/playoff-settings", json={"season": season, "playoff_team_count": 6}
        )
        assert put_resp.status_code == 200
        assert put_resp.json()["playoff_team_count"] == 6

        get_resp = await client.get("/league/playoff-settings")
    assert get_resp.json()["playoff_team_count"] == 6


async def test_commissioner_can_set_weeks_per_matchup_and_start_week(pool):
    async with _client() as client:
        await _sign_up(client, "test-playoff-weeks@example.com")
        await client.post("/leagues", json={"name": "Test League Playoff Weeks"})
        season = (await client.get("/league/playoff-settings")).json()["season"]

        put_resp = await client.put(
            "/league/playoff-settings",
            json={"season": season, "playoff_team_count": 4, "weeks_per_matchup": 2, "start_week": 15},
        )
        assert put_resp.status_code == 200
        assert put_resp.json()["weeks_per_matchup"] == 2
        assert put_resp.json()["start_week"] == 15

        get_resp = await client.get("/league/playoff-settings")
    assert get_resp.json()["weeks_per_matchup"] == 2
    assert get_resp.json()["start_week"] == 15


async def test_weeks_per_matchup_defaults_to_one_when_omitted(pool):
    async with _client() as client:
        await _sign_up(client, "test-playoff-weeks-default@example.com")
        await client.post("/leagues", json={"name": "Test League Playoff Weeks Default"})
        season = (await client.get("/league/playoff-settings")).json()["season"]

        put_resp = await client.put("/league/playoff-settings", json={"season": season, "playoff_team_count": 4})
    assert put_resp.json()["weeks_per_matchup"] == 1
    assert put_resp.json()["start_week"] is None


async def test_weeks_per_matchup_must_be_positive(pool):
    async with _client() as client:
        await _sign_up(client, "test-playoff-weeks-invalid@example.com")
        await client.post("/leagues", json={"name": "Test League Playoff Weeks Invalid"})
        season = (await client.get("/league/playoff-settings")).json()["season"]

        resp = await client.put(
            "/league/playoff-settings", json={"season": season, "playoff_team_count": 4, "weeks_per_matchup": 0}
        )
    assert resp.status_code == 400


async def test_commissioner_can_generate_regular_season_schedule(pool):
    async with _client() as client:
        await _sign_up(client, "test-schedule-gen@example.com")
        created = await client.post("/leagues", json={"name": "Test League Schedule Gen"})
        league_id = created.json()["id"]
        season = (await client.get("/league/playoff-settings")).json()["season"]

        async with pool.acquire() as conn:
            for i in range(4):
                owner_id = await conn.fetchval(
                    "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
                    f"test-schedule-owner-{i}", f"Schedule Owner {i}",
                )
                await conn.execute(
                    "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
                    "VALUES ($1, $2, $3, $4, $5)",
                    season, 600 + i, owner_id, f"Schedule Team {i}", league_id,
                )

        resp = await client.post("/league/schedule/generate", json={"season": season, "weeks": 3})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["matchups"]) == 6  # 4 teams, 3 weeks, 2 games/week


async def test_generate_schedule_rejects_if_already_scheduled(pool):
    async with _client() as client:
        await _sign_up(client, "test-schedule-dup@example.com")
        created = await client.post("/leagues", json={"name": "Test League Schedule Dup"})
        league_id = created.json()["id"]
        season = (await client.get("/league/playoff-settings")).json()["season"]

        async with pool.acquire() as conn:
            for i in range(2):
                owner_id = await conn.fetchval(
                    "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
                    f"test-schedule-dup-owner-{i}", f"Schedule Dup Owner {i}",
                )
                await conn.execute(
                    "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
                    "VALUES ($1, $2, $3, $4, $5)",
                    season, 610 + i, owner_id, f"Schedule Dup Team {i}", league_id,
                )

        first = await client.post("/league/schedule/generate", json={"season": season, "weeks": 1})
        assert first.status_code == 200
        second = await client.post("/league/schedule/generate", json={"season": season, "weeks": 1})
    assert second.status_code == 409


async def test_generate_schedule_requires_positive_weeks(pool):
    async with _client() as client:
        await _sign_up(client, "test-schedule-invalid@example.com")
        await client.post("/leagues", json={"name": "Test League Schedule Invalid"})
        season = (await client.get("/league/playoff-settings")).json()["season"]

        resp = await client.post("/league/schedule/generate", json={"season": season, "weeks": 0})
    assert resp.status_code == 400


async def test_non_commissioner_cannot_generate_schedule(pool):
    async with _client() as creator:
        await _sign_up(creator, "test-schedule-unauth-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Schedule Unauth"})
        invite_code = created.json()["invite_code"]
        season = (await creator.get("/league/playoff-settings")).json()["season"]

    async with _client() as member:
        await _sign_up(member, "test-schedule-unauth-member@example.com")
        await member.post("/leagues/join", json={"invite_code": invite_code})
        resp = await member.post("/league/schedule/generate", json={"season": season, "weeks": 1})
    assert resp.status_code == 403


async def test_playoff_team_count_must_be_positive(pool):
    async with _client() as client:
        await _sign_up(client, "test-playoff-invalid@example.com")
        await client.post("/leagues", json={"name": "Test League Playoff Invalid"})
        season = (await client.get("/league/playoff-settings")).json()["season"]

        resp = await client.put("/league/playoff-settings", json={"season": season, "playoff_team_count": 0})
    assert resp.status_code == 400


async def test_non_commissioner_cannot_set_playoff_team_count(pool):
    async with _client() as creator:
        await _sign_up(creator, "test-playoff-unauth-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Playoff Unauth"})
        invite_code = created.json()["invite_code"]
        season = (await creator.get("/league/playoff-settings")).json()["season"]

    async with _client() as member:
        await _sign_up(member, "test-playoff-unauth-member@example.com")
        await member.post("/leagues/join", json={"invite_code": invite_code})
        resp = await member.put("/league/playoff-settings", json={"season": season, "playoff_team_count": 4})
    assert resp.status_code == 403


async def test_playoff_setting_overrides_the_historical_inference(pool):
    """The one real consumer (queries/league.py's get_playoff_team_count,
    powering the standings page's playoff-line divider) must prefer an
    explicit setting over inferring from a prior season's real bracket —
    confirms the actual read path, not just the settings round-trip."""
    from app.queries import league as league_read_queries

    async with _client() as client:
        await _sign_up(client, "test-playoff-override@example.com")
        created = await client.post("/leagues", json={"name": "Test League Playoff Override"})
        league_id = created.json()["id"]
        season = (await client.get("/league/playoff-settings")).json()["season"]

        await client.put("/league/playoff-settings", json={"season": season, "playoff_team_count": 8})

    async with pool.acquire() as conn:
        count = await league_read_queries.get_playoff_team_count(conn, season, league_id)
    assert count == 8


async def test_updating_scoring_rules_only_affects_this_league(pool):
    """Two leagues both seeded from League #1's real values — updating
    one's rules doesn't leak into the other (league_scoring_rules'
    (season, stat_category, league_id) unique constraint / this
    endpoint's league_id scoping actually working)."""
    async with _client() as first:
        await _sign_up(first, "test-scoring-isolation-first@example.com")
        await first.post("/leagues", json={"name": "Test League Scoring Isolation First"})
        season = (await first.get("/league/scoring-rules")).json()["season"]
        await first.put("/league/scoring-rules", json={"season": season, "rules": {"pass_td": 11.0}})

    async with _client() as second:
        await _sign_up(second, "test-scoring-isolation-second@example.com")
        await second.post("/leagues", json={"name": "Test League Scoring Isolation Second"})
        rules_resp = await second.get("/league/scoring-rules")
    rules = {r["stat_category"]: r["points_per_unit"] for r in rules_resp.json()["rules"]}
    assert rules["pass_td"] != 11.0
