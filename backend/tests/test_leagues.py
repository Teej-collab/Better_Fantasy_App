from httpx import ASGITransport, AsyncClient

from app.main import app

TEST_SEASON = 1900  # matches conftest.TEST_SEASON


def _client(base_url="http://test"):
    return AsyncClient(transport=ASGITransport(app=app), base_url=base_url)


async def _signed_up_client(email: str, display_name: str = "Test Person"):
    client = _client()
    resp = await client.post(
        "/auth/signup", json={"email": email, "password": "correct-horse", "display_name": display_name}
    )
    assert resp.status_code == 200
    return client


async def test_create_league_requires_session():
    async with _client() as client:
        resp = await client.post("/leagues", json={"name": "Test League Requires Session"})
    assert resp.status_code == 401


async def test_create_league_makes_creator_commissioner(pool):
    client = await _signed_up_client("test-leagues-create@example.com")
    async with client:
        resp = await client.post("/leagues", json={"name": "Test League Alpha"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Test League Alpha"
        assert body["role"] == "commissioner"
        assert body["invite_code"]

        mine_resp = await client.get("/leagues/mine")
        assert mine_resp.status_code == 200
        names = [league["name"] for league in mine_resp.json()["leagues"]]
        assert "Test League Alpha" in names


async def test_join_league_with_valid_invite_code(pool):
    creator = await _signed_up_client("test-leagues-join-creator@example.com")
    async with creator:
        created = await creator.post("/leagues", json={"name": "Test League Join Target"})
        invite_code = created.json()["invite_code"]

    joiner = await _signed_up_client("test-leagues-join-joiner@example.com")
    async with joiner:
        resp = await joiner.post("/leagues/join", json={"invite_code": invite_code})
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Test League Join Target"
        assert body["role"] == "member"


async def test_join_league_rejects_invalid_invite_code(pool):
    client = await _signed_up_client("test-leagues-bad-code@example.com")
    async with client:
        resp = await client.post("/leagues/join", json={"invite_code": "not-a-real-code"})
    assert resp.status_code == 404


async def test_create_team_requires_membership(pool):
    creator = await _signed_up_client("test-leagues-team-creator@example.com")
    async with creator:
        created = await creator.post("/leagues", json={"name": "Test League Team Membership"})
        league_id = created.json()["id"]

    outsider = await _signed_up_client("test-leagues-team-outsider@example.com")
    async with outsider:
        resp = await outsider.post(f"/leagues/{league_id}/teams", json={"team_name": "Outsider FC"})
    assert resp.status_code == 403


async def test_create_team_succeeds_for_member_and_appears_in_list(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    client = await _signed_up_client("test-leagues-team-member@example.com", display_name="Team Owner")
    async with client:
        created = await client.post("/leagues", json={"name": "Test League Team Success"})
        league_id = created.json()["id"]

        resp = await client.post(f"/leagues/{league_id}/teams", json={"team_name": "The Champs"})
        assert resp.status_code == 200
        team = resp.json()
        assert team["team_name"] == "The Champs"
        assert team["league_id"] == league_id
        assert team["season"] == TEST_SEASON

        list_resp = await client.get(f"/leagues/{league_id}/teams")
        assert list_resp.status_code == 200
        team_names = [t["team_name"] for t in list_resp.json()["teams"]]
        assert "The Champs" in team_names


async def test_create_team_rejects_a_second_team_for_the_same_owner(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    client = await _signed_up_client("test-leagues-team-dup@example.com")
    async with client:
        created = await client.post("/leagues", json={"name": "Test League Team Dup"})
        league_id = created.json()["id"]

        first = await client.post(f"/leagues/{league_id}/teams", json={"team_name": "First Team"})
        assert first.status_code == 200
        second = await client.post(f"/leagues/{league_id}/teams", json={"team_name": "Second Team"})
        assert second.status_code == 409
