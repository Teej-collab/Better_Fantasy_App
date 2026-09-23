"""Co-owner invites (2026-09-22 real ask: let a team owner invite a
friend to co-manage the same team). Both people end up sharing the
exact same owner_id (see app/queries/leagues.py's create_co_owner_invite/
redeem_co_owner_invite docstrings for why this is a deliberately shared
identity, not a distinct second person) — these tests exercise the
generate/redeem HTTP flow and the invariants it must hold."""
from httpx import ASGITransport, AsyncClient

from app.auth.config import SessionConfig
from app.auth.session import decode_session_token
from app.main import app

TEST_SEASON = 1900  # matches conftest.TEST_SEASON


def _client(base_url="http://test"):
    return AsyncClient(transport=ASGITransport(app=app), base_url=base_url)


async def _sign_up(client: AsyncClient, email: str, display_name: str = "Test Person"):
    resp = await client.post(
        "/auth/signup", json={"email": email, "password": "correct-horse", "display_name": display_name}
    )
    assert resp.status_code == 200
    return resp.json()


async def _create_league_and_team(client: AsyncClient, league_name: str, team_name: str):
    created = await client.post("/leagues", json={"name": league_name})
    assert created.status_code == 200, created.text
    league_id = created.json()["id"]
    team_resp = await client.post(f"/leagues/{league_id}/teams", json={"team_name": team_name})
    assert team_resp.status_code == 200, team_resp.text
    return league_id, team_resp.json()


async def test_generate_and_redeem_co_owner_invite_links_same_owner_id(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))

    async with _client() as owner_client:
        await _sign_up(owner_client, "test-coowner-owner@example.com")
        league_id, team = await _create_league_and_team(owner_client, "Test League CoOwner", "Owner's Team")

        invite_resp = await owner_client.post("/leagues/co-owner-invite")
        assert invite_resp.status_code == 200, invite_resp.text
        invite_code = invite_resp.json()["invite_code"]
        assert invite_code

    async with _client() as friend_client:
        await _sign_up(friend_client, "test-coowner-friend@example.com")
        redeem_resp = await friend_client.post("/leagues/co-owner-invites/redeem", json={"invite_code": invite_code})
        assert redeem_resp.status_code == 200, redeem_resp.text
        body = redeem_resp.json()
        assert body["owner_id"] == team["owner_id"]

        decoded = decode_session_token(SessionConfig().session_secret, body["token"])
        assert decoded["owner_id"] == team["owner_id"]

        # Redemption also grants league membership without a separate
        # /leagues/join call — the whole point of a targeted co-owner
        # invite over the general invite_code flow.
        friend_client.cookies.update({"session": body["token"]})
        mine_resp = await friend_client.get("/leagues/mine")
        assert any(league["id"] == league_id for league in mine_resp.json()["leagues"])


async def test_redeem_co_owner_invite_twice_fails(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))

    async with _client() as owner_client:
        await _sign_up(owner_client, "test-coowner-twice-owner@example.com")
        league_id, team = await _create_league_and_team(owner_client, "Test League CoOwner Twice", "Team")
        invite_resp = await owner_client.post("/leagues/co-owner-invite")
        invite_code = invite_resp.json()["invite_code"]

    async with _client() as first_friend:
        await _sign_up(first_friend, "test-coowner-twice-first@example.com")
        first_redeem = await first_friend.post("/leagues/co-owner-invites/redeem", json={"invite_code": invite_code})
        assert first_redeem.status_code == 200, first_redeem.text

    async with _client() as second_friend:
        await _sign_up(second_friend, "test-coowner-twice-second@example.com")
        second_redeem = await second_friend.post("/leagues/co-owner-invites/redeem", json={"invite_code": invite_code})
    assert second_redeem.status_code == 409


async def test_redeem_co_owner_invite_rejects_a_caller_who_already_has_a_different_owner(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))

    async with _client() as owner_client:
        await _sign_up(owner_client, "test-coowner-conflict-owner@example.com")
        league_id, team = await _create_league_and_team(owner_client, "Test League CoOwner Conflict", "Team")
        invite_resp = await owner_client.post("/leagues/co-owner-invite")
        invite_code = invite_resp.json()["invite_code"]

    async with _client() as other_owner_client:
        await _sign_up(other_owner_client, "test-coowner-conflict-other@example.com")
        # This account already claims its own owner identity via its own team.
        await _create_league_and_team(other_owner_client, "Test League CoOwner Conflict Other", "Other Team")

        redeem_resp = await other_owner_client.post("/leagues/co-owner-invites/redeem", json={"invite_code": invite_code})
    assert redeem_resp.status_code == 409


async def test_co_owner_invite_requires_having_a_team(pool, monkeypatch):
    """A signed-up account with no owner identity yet (never created or
    joined a team) has nothing to invite a co-owner onto."""
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))

    async with _client() as bystander_client:
        await _sign_up(bystander_client, "test-coowner-noteam-bystander@example.com")
        resp = await bystander_client.post("/leagues/co-owner-invite")
    assert resp.status_code == 403
