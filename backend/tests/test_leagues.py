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


async def _login(client: AsyncClient, email: str):
    """For a second AsyncClient (its own cookie jar) representing the
    SAME already-signed-up person coming back — _sign_up itself can't
    be reused for this, it 409s on an email that's already registered."""
    resp = await client.post("/auth/login", json={"email": email, "password": "correct-horse"})
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


async def test_commissioner_can_rename_their_league(pool):
    async with _client() as client:
        await _sign_up(client, "test-leagues-rename-comm@example.com")
        created = await client.post("/leagues", json={"name": "Test League Rename Original"})
        league_id = created.json()["id"]

        resp = await client.patch(f"/leagues/{league_id}", json={"name": "Test League Rename Updated"})
        assert resp.status_code == 200
        assert resp.json()["name"] == "Test League Rename Updated"

        mine_resp = await client.get("/leagues/mine")
        names = [league["name"] for league in mine_resp.json()["leagues"]]
        assert "Test League Rename Updated" in names


async def test_non_commissioner_cannot_rename_league(pool):
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-rename-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Rename Guarded"})
        league_id = created.json()["id"]
        invite_code = created.json()["invite_code"]

    async with _client() as member:
        await _sign_up(member, "test-leagues-rename-member@example.com")
        await member.post("/leagues/join", json={"invite_code": invite_code})
        resp = await member.patch(f"/leagues/{league_id}", json={"name": "Test League Rename Hijacked"})
    assert resp.status_code == 403


async def test_rename_league_rejects_blank_name(pool):
    async with _client() as client:
        await _sign_up(client, "test-leagues-rename-blank@example.com")
        created = await client.post("/leagues", json={"name": "Test League Rename Blank"})
        league_id = created.json()["id"]

        resp = await client.patch(f"/leagues/{league_id}", json={"name": "   "})
    assert resp.status_code == 400


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
    body = resp.json()
    assert body["owner_id"] == owner_id
    assert body["claimed"] is True
    # A real, usable session token, not just a claimed flag — see this
    # endpoint's own docstring for why: owner_id lives in the JWT, set
    # once at login, so the caller's OLD cookie still has no owner_id
    # even after this DB write succeeds. Decoding it here confirms the
    # NEW token actually carries the newly-linked owner_id.
    from app.auth.config import SessionConfig
    from app.auth.session import decode_session_token

    decoded = decode_session_token(SessionConfig().session_secret, body["token"])
    assert decoded["owner_id"] == owner_id

    async with _client() as second_claimer:
        await _sign_up(second_claimer, "test-leagues-claim-second@example.com")
        await second_claimer.post("/leagues/join", json={"invite_code": invite_code})
        resp2 = await second_claimer.post(f"/leagues/{league_id}/claim-owner", json={"owner_id": owner_id})
    assert resp2.status_code == 409


async def test_claim_owner_new_token_actually_unlocks_owner_scoped_routes(pool, monkeypatch):
    """The real, reported bug: a signed-up-by-email owner claims their
    historical team, then GET /me/team still 404s "No team found for
    this owner" — because that route reads owner_id straight off the
    JWT (app/routers/me.py's _require_my_team), and the caller's
    existing cookie was minted at signup with no owner_id at all.
    Claiming updates the DB correctly but does nothing for a cookie
    already sitting in the browser. Confirms the fix: swapping in the
    token this endpoint now returns is what actually unlocks the route,
    not the claim DB write by itself."""
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-claim-unlock-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Claim Unlock"})
        league_id = created.json()["id"]
        invite_code = created.json()["invite_code"]

    from app.db import get_pool as _get_pool

    real_pool = await _get_pool()
    async with real_pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-leagues-claim-unlock-owner", "Unlockable Owner",
        )
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
            "VALUES ($1, nextval('synthetic_espn_team_id_seq'), $2, 'Unlockable FC', $3)",
            TEST_SEASON, owner_id, league_id,
        )

    async with _client() as claimer:
        await _sign_up(claimer, "test-leagues-claim-unlock-claimer@example.com")
        await claimer.post("/leagues/join", json={"invite_code": invite_code})

        # Before claiming: the caller's own account genuinely has no
        # team yet, so this 404s correctly.
        before = await claimer.get("/me/team")
        assert before.status_code == 404

        resp = await claimer.post(f"/leagues/{league_id}/claim-owner", json={"owner_id": owner_id})
        assert resp.status_code == 200
        token = resp.json()["token"]

        # Still using the OLD cookie this client already has: claiming
        # updated the DB, but not this in-flight session — still 404,
        # proving the DB write alone was never going to be enough.
        still_before = await claimer.get("/me/team")
        assert still_before.status_code == 404

        # Swap in the new token exactly as the frontend now does via
        # /auth/complete/set-cookie — this is the actual fix.
        claimer.cookies.set("session", token)
        after = await claimer.get("/me/team")
    assert after.status_code == 200
    assert after.json()["team_name"] == "Unlockable FC"


async def test_a_later_password_login_still_carries_the_claimed_owner_id(pool, monkeypatch):
    """The deeper half of the same bug: fixing claim-owner to reissue a
    token isn't enough on its own if the NEXT time this person logs in
    (a new device, a cleared cookie jar, the 30-day cookie finally
    expiring) mints a fresh owner_id=null token all over again.
    app/routers/auth.py's login() now resolves owner_id fresh from the
    DB (app/queries/auth.py's get_owner_id_for_user) on every login,
    not just at the moment of claiming — this proves a real second
    login, in a client that never saw the claim-owner response at all,
    still gets the right owner_id."""
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-claim-relogin-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Claim Relogin"})
        league_id = created.json()["id"]
        invite_code = created.json()["invite_code"]

    from app.db import get_pool as _get_pool

    real_pool = await _get_pool()
    async with real_pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-leagues-claim-relogin-owner", "Relogin Owner",
        )
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
            "VALUES ($1, nextval('synthetic_espn_team_id_seq'), $2, 'Relogin FC', $3)",
            TEST_SEASON, owner_id, league_id,
        )

    async with _client() as claimer:
        await _sign_up(claimer, "test-leagues-claim-relogin-claimer@example.com")
        await claimer.post("/leagues/join", json={"invite_code": invite_code})
        resp = await claimer.post(f"/leagues/{league_id}/claim-owner", json={"owner_id": owner_id})
        assert resp.status_code == 200

    # A genuinely separate client — no cookie, no token from the claim
    # response above, just a plain email+password login the way a
    # returning visitor on a new device would actually experience it.
    async with _client() as returning:
        await _login(returning, "test-leagues-claim-relogin-claimer@example.com")
        me_resp = await returning.get("/auth/me")
    assert me_resp.status_code == 200
    assert me_resp.json()["owner_id"] == owner_id


async def test_commissioner_can_remove_a_member(pool):
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-remove-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Remove Member"})
        league_id = created.json()["id"]
        invite_code = created.json()["invite_code"]

    async with _client() as member:
        await _sign_up(member, "test-leagues-remove-member@example.com")
        await member.post("/leagues/join", json={"invite_code": invite_code})
        member_id = (await member.get("/leagues/mine")).json()["active_league_id"]
        assert member_id == league_id
        member_user_resp = await member.get("/auth/me")
        member_user_id = member_user_resp.json()["user_id"]

    async with _client() as creator2:
        await _login(creator2, "test-leagues-remove-creator@example.com")
        resp = await creator2.delete(f"/leagues/{league_id}/members/{member_user_id}")
    assert resp.status_code == 200
    assert resp.json() == {"user_id": member_user_id, "removed": True}

    async with _client() as member2:
        await _login(member2, "test-leagues-remove-member@example.com")
        mine_resp = await member2.get("/leagues/mine")
    names = [league["name"] for league in mine_resp.json()["leagues"]]
    assert "Test League Remove Member" not in names
    assert mine_resp.json()["active_league_id"] is None


async def test_remove_member_rejects_removing_yourself(pool):
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-remove-self@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Remove Self"})
        league_id = created.json()["id"]
        my_user_id = (await creator.get("/auth/me")).json()["user_id"]
        resp = await creator.delete(f"/leagues/{league_id}/members/{my_user_id}")
    assert resp.status_code == 400


async def test_removing_a_co_commissioner_leaves_the_caller_as_commissioner(pool):
    """There's no separate "can't remove the league's only commissioner"
    guard needed on top of the self-removal block: the caller must
    already be a commissioner to reach DELETE .../members/{id} at all,
    and can never target their own row, so removing anyone else always
    leaves the caller themselves behind as a commissioner. This proves
    that directly — removing a co-commissioner succeeds, and the league
    still has one (the caller)."""
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-remove-coco@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Remove Coco"})
        league_id = created.json()["id"]
        invite_code = created.json()["invite_code"]

    async with _client() as member:
        await _sign_up(member, "test-leagues-remove-coco-member@example.com")
        await member.post("/leagues/join", json={"invite_code": invite_code})
        member_user_id = (await member.get("/auth/me")).json()["user_id"]

    async with _client() as creator2:
        await _login(creator2, "test-leagues-remove-coco@example.com")
        promote_resp = await creator2.patch(
            f"/leagues/{league_id}/members/{member_user_id}", json={"role": "commissioner"}
        )
        assert promote_resp.status_code == 200

        resp = await creator2.delete(f"/leagues/{league_id}/members/{member_user_id}")
        assert resp.status_code == 200

        # The caller (still a commissioner) can still do commissioner things.
        rename_resp = await creator2.patch(f"/leagues/{league_id}", json={"name": "Test League Remove Coco Renamed"})
    assert rename_resp.status_code == 200


async def test_non_commissioner_cannot_remove_a_member(pool):
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-remove-unauth-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Remove Unauth"})
        league_id = created.json()["id"]
        invite_code = created.json()["invite_code"]

    async with _client() as member_a:
        await _sign_up(member_a, "test-leagues-remove-unauth-a@example.com")
        await member_a.post("/leagues/join", json={"invite_code": invite_code})
        member_a_user_id = (await member_a.get("/auth/me")).json()["user_id"]

    async with _client() as member_b:
        await _sign_up(member_b, "test-leagues-remove-unauth-b@example.com")
        await member_b.post("/leagues/join", json={"invite_code": invite_code})
        resp = await member_b.delete(f"/leagues/{league_id}/members/{member_a_user_id}")
    assert resp.status_code == 403


async def test_commissioner_can_reassign_a_team_to_another_member(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-reassign-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Reassign"})
        league_id = created.json()["id"]
        invite_code = created.json()["invite_code"]

    async with _client() as original_owner:
        await _sign_up(original_owner, "test-leagues-reassign-original@example.com")
        await original_owner.post("/leagues/join", json={"invite_code": invite_code})
        team_resp = await original_owner.post(f"/leagues/{league_id}/teams", json={"team_name": "Original Team"})
        team_id = team_resp.json()["team_id"]

    async with _client() as replacement:
        await _sign_up(replacement, "test-leagues-reassign-replacement@example.com", display_name="Replacement Owner")
        await replacement.post("/leagues/join", json={"invite_code": invite_code})
        replacement_user_id = (await replacement.get("/auth/me")).json()["user_id"]

    async with _client() as creator2:
        await _login(creator2, "test-leagues-reassign-creator@example.com")
        resp = await creator2.post(
            f"/leagues/{league_id}/teams/{team_id}/reassign", json={"user_id": replacement_user_id}
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["team_id"] == team_id
    assert body["team_name"] == "Original Team"

    async with _client() as check:
        await _login(check, "test-leagues-reassign-creator@example.com")
        teams_resp = await check.get(f"/leagues/{league_id}/teams")
    team = next(t for t in teams_resp.json()["teams"] if t["team_id"] == team_id)
    assert team["owner_name"] == "Replacement Owner"


async def test_reassign_team_rejects_a_non_member_target(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-reassign-nonmember-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Reassign Nonmember"})
        league_id = created.json()["id"]
        invite_code = created.json()["invite_code"]

    async with _client() as original_owner:
        await _sign_up(original_owner, "test-leagues-reassign-nonmember-original@example.com")
        await original_owner.post("/leagues/join", json={"invite_code": invite_code})
        team_resp = await original_owner.post(f"/leagues/{league_id}/teams", json={"team_name": "A Team"})
        team_id = team_resp.json()["team_id"]

    async with _client() as outsider:
        await _sign_up(outsider, "test-leagues-reassign-nonmember-outsider@example.com")
        outsider_user_id = (await outsider.get("/auth/me")).json()["user_id"]

    async with _client() as creator2:
        await _login(creator2, "test-leagues-reassign-nonmember-creator@example.com")
        resp = await creator2.post(f"/leagues/{league_id}/teams/{team_id}/reassign", json={"user_id": outsider_user_id})
    assert resp.status_code == 400


async def test_commissioner_can_create_a_team_for_a_member(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-forteam-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League For Member"})
        league_id = created.json()["id"]
        invite_code = created.json()["invite_code"]

    async with _client() as member:
        await _sign_up(member, "test-leagues-forteam-member@example.com", display_name="New Member")
        await member.post("/leagues/join", json={"invite_code": invite_code})
        member_user_id = (await member.get("/auth/me")).json()["user_id"]

    async with _client() as creator2:
        await _login(creator2, "test-leagues-forteam-creator@example.com")
        resp = await creator2.post(
            f"/leagues/{league_id}/teams/for-member", json={"user_id": member_user_id, "team_name": "Commish-Made Team"}
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["team_name"] == "Commish-Made Team"

    async with _client() as check:
        await _login(check, "test-leagues-forteam-creator@example.com")
        teams_resp = await check.get(f"/leagues/{league_id}/teams")
    team = next(t for t in teams_resp.json()["teams"] if t["team_id"] == body["team_id"])
    assert team["owner_name"] == "New Member"


async def test_create_team_for_member_requires_commissioner(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-forteam-noncomm-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League For Member Noncomm"})
        league_id = created.json()["id"]
        invite_code = created.json()["invite_code"]

    async with _client() as member:
        await _sign_up(member, "test-leagues-forteam-noncomm-member@example.com")
        await member.post("/leagues/join", json={"invite_code": invite_code})
        member_user_id = (await member.get("/auth/me")).json()["user_id"]

        resp = await member.post(
            f"/leagues/{league_id}/teams/for-member", json={"user_id": member_user_id, "team_name": "Should Fail"}
        )
    assert resp.status_code == 403


async def test_create_team_for_member_rejects_a_non_member_target(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-forteam-nonmember-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League For Member Nonmember"})
        league_id = created.json()["id"]

    async with _client() as outsider:
        await _sign_up(outsider, "test-leagues-forteam-nonmember-outsider@example.com")
        outsider_user_id = (await outsider.get("/auth/me")).json()["user_id"]

    async with _client() as creator2:
        await _login(creator2, "test-leagues-forteam-nonmember-creator@example.com")
        resp = await creator2.post(
            f"/leagues/{league_id}/teams/for-member", json={"user_id": outsider_user_id, "team_name": "Should Fail"}
        )
    assert resp.status_code == 400


async def test_create_team_for_member_rejects_a_second_team_for_the_same_owner(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async with _client() as creator:
        await _sign_up(creator, "test-leagues-forteam-dupe-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League For Member Dupe"})
        league_id = created.json()["id"]
        invite_code = created.json()["invite_code"]

    async with _client() as member:
        await _sign_up(member, "test-leagues-forteam-dupe-member@example.com")
        await member.post("/leagues/join", json={"invite_code": invite_code})
        member_user_id = (await member.get("/auth/me")).json()["user_id"]
        await member.post(f"/leagues/{league_id}/teams", json={"team_name": "Self-Served Team"})

    async with _client() as creator2:
        await _login(creator2, "test-leagues-forteam-dupe-creator@example.com")
        resp = await creator2.post(
            f"/leagues/{league_id}/teams/for-member", json={"user_id": member_user_id, "team_name": "Duplicate Team"}
        )
    assert resp.status_code == 409
