from httpx import ASGITransport, AsyncClient

from app.main import app

TEST_SEASON = 1900  # matches conftest.TEST_SEASON


def _client(base_url="http://test"):
    return AsyncClient(transport=ASGITransport(app=app), base_url=base_url)


async def _sign_up(client: AsyncClient, email: str, display_name: str = "Test Person"):
    resp = await client.post(
        "/auth/signup", json={"email": email, "password": "correct-horse", "display_name": display_name}
    )
    assert resp.status_code == 200


async def test_create_league_requires_session():
    async with _client() as client:
        resp = await client.post("/leagues", json={"name": "Test League Requires Session"})
    assert resp.status_code == 401


async def test_create_league_makes_creator_commissioner(pool):
    async with _client() as client:
        await _sign_up(client, "test-leagues-create@example.com")

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
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-join-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Join Target"})
        invite_code = created.json()["invite_code"]

    async with _client() as joiner:
        await _sign_up(joiner, "test-leagues-join-joiner@example.com")
        resp = await joiner.post("/leagues/join", json={"invite_code": invite_code})
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Test League Join Target"
        assert body["role"] == "member"


async def test_join_league_rejects_invalid_invite_code(pool):
    async with _client() as client:
        await _sign_up(client, "test-leagues-bad-code@example.com")
        resp = await client.post("/leagues/join", json={"invite_code": "not-a-real-code"})
    assert resp.status_code == 404


async def test_create_team_requires_membership(pool):
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-team-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Team Membership"})
        league_id = created.json()["id"]

    async with _client() as outsider:
        await _sign_up(outsider, "test-leagues-team-outsider@example.com")
        resp = await outsider.post(f"/leagues/{league_id}/teams", json={"team_name": "Outsider FC"})
    assert resp.status_code == 403


async def test_create_team_succeeds_for_member_and_appears_in_list(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async with _client() as client:
        await _sign_up(client, "test-leagues-team-member@example.com", display_name="Team Owner")
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
    async with _client() as client:
        await _sign_up(client, "test-leagues-team-dup@example.com")
        created = await client.post("/leagues", json={"name": "Test League Team Dup"})
        league_id = created.json()["id"]

        first = await client.post(f"/leagues/{league_id}/teams", json={"team_name": "First Team"})
        assert first.status_code == 200
        second = await client.post(f"/leagues/{league_id}/teams", json={"team_name": "Second Team"})
        assert second.status_code == 409


async def test_creating_a_league_auto_activates_it(pool):
    """add_member's auto-activate-if-none-set (queries/leagues.py) —
    creating your first league needs zero extra clicks to start seeing
    its data."""
    async with _client() as client:
        await _sign_up(client, "test-leagues-autoactivate@example.com")
        created = await client.post("/leagues", json={"name": "Test League Auto Activate"})
        league_id = created.json()["id"]

        mine_resp = await client.get("/leagues/mine")
        assert mine_resp.json()["active_league_id"] == league_id


async def test_joining_a_second_league_does_not_switch_active_league(pool):
    """add_member never overwrites an existing active_league_id —
    joining a second league doesn't silently switch you away from the
    one you're already using."""
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-noswitch-creator@example.com")
        second = await creator.post("/leagues", json={"name": "Test League No Switch Second"})
        invite_code = second.json()["invite_code"]

    async with _client() as joiner:
        await _sign_up(joiner, "test-leagues-noswitch-joiner@example.com")
        first = await joiner.post("/leagues", json={"name": "Test League No Switch First"})
        first_id = first.json()["id"]

        await joiner.post("/leagues/join", json={"invite_code": invite_code})

        mine_resp = await joiner.get("/leagues/mine")
        assert mine_resp.json()["active_league_id"] == first_id


async def test_select_league_requires_real_membership(pool):
    async with _client() as outsider:
        await _sign_up(outsider, "test-leagues-select-outsider@example.com")

    async with _client() as creator:
        await _sign_up(creator, "test-leagues-select-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Select"})
        league_id = created.json()["id"]

    async with _client() as outsider2:
        await _sign_up(outsider2, "test-leagues-select-outsider2@example.com")
        resp = await outsider2.post(f"/leagues/{league_id}/select")
    assert resp.status_code == 403


async def test_select_league_switches_active_league_for_a_real_member(pool):
    async with _client() as client:
        await _sign_up(client, "test-leagues-select-switch@example.com")
        first = await client.post("/leagues", json={"name": "Test League Select Switch First"})
        second = await client.post("/leagues", json={"name": "Test League Select Switch Second"})
        first_id, second_id = first.json()["id"], second.json()["id"]

        mine_before = await client.get("/leagues/mine")
        assert mine_before.json()["active_league_id"] == first_id

        select_resp = await client.post(f"/leagues/{second_id}/select")
        assert select_resp.status_code == 200
        assert select_resp.json()["active_league_id"] == second_id

        mine_after = await client.get("/leagues/mine")
        assert mine_after.json()["active_league_id"] == second_id


async def test_unclaimed_owners_lists_only_this_leagues_unlinked_owners(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async with _client() as client:
        await _sign_up(client, "test-leagues-unclaimed@example.com")
        created = await client.post("/leagues", json={"name": "Test League Unclaimed"})
        league_id = created.json()["id"]

    from app.db import get_pool as _get_pool

    real_pool = await _get_pool()
    async with real_pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-leagues-unclaimed-owner", "Unclaimed Owner",
        )
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
            "VALUES ($1, nextval('synthetic_espn_team_id_seq'), $2, 'Unclaimed FC', $3)",
            TEST_SEASON, owner_id, league_id,
        )

    async with _client() as client2:
        await _sign_up(client2, "test-leagues-unclaimed2@example.com")
        # Join the same league so membership passes, using the invite code.
        invite_code = created.json()["invite_code"]
        await client2.post("/leagues/join", json={"invite_code": invite_code})
        resp = await client2.get(f"/leagues/{league_id}/unclaimed-owners")

    assert resp.status_code == 200
    names = [o["display_name"] for o in resp.json()["owners"]]
    assert "Unclaimed Owner" in names


async def test_claim_owner_links_history_and_is_first_claim_wins(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-claim-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Claim"})
        league_id = created.json()["id"]
        invite_code = created.json()["invite_code"]

    from app.db import get_pool as _get_pool

    real_pool = await _get_pool()
    async with real_pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-leagues-claim-owner", "Claimable Owner",
        )
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
            "VALUES ($1, nextval('synthetic_espn_team_id_seq'), $2, 'Claimable FC', $3)",
            TEST_SEASON, owner_id, league_id,
        )

    async with _client() as claimer:
        await _sign_up(claimer, "test-leagues-claim-claimer@example.com")
        await claimer.post("/leagues/join", json={"invite_code": invite_code})
        resp = await claimer.post(f"/leagues/{league_id}/claim-owner", json={"owner_id": owner_id})
    assert resp.status_code == 200
    assert resp.json() == {"owner_id": owner_id, "claimed": True}

    async with _client() as second_claimer:
        await _sign_up(second_claimer, "test-leagues-claim-second@example.com")
        await second_claimer.post("/leagues/join", json={"invite_code": invite_code})
        resp2 = await second_claimer.post(f"/leagues/{league_id}/claim-owner", json={"owner_id": owner_id})
    assert resp2.status_code == 409
