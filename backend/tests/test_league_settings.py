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
