from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app
from app.queries import keepers as keeper_queries
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_PRIOR_SEASON = TEST_SEASON - 1


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _session_cookie(owner_id: int, is_commissioner: bool = False):
    token = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=owner_id, discord_user_id=100000 + owner_id, is_commissioner=is_commissioner
    )
    return {"session": token}


def _set_env(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))


async def _seed_owner_with_roster(pool, suffix, espn_team_id, players):
    """players: list of (espn_player_id, player_name, position). Seeds
    the owner's PRIOR_SEASON team + a single week's roster (week 17,
    the "last roster of the season" a keeper picker sources from)."""
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-keepers-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            _PRIOR_SEASON, espn_team_id, owner_id, f"Team {suffix}",
        )
        for espn_player_id, player_name, position in players:
            await conn.execute(
                "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, espn_player_id) "
                "VALUES ($1, 17, $2, $3, $4, $4, $5)",
                _PRIOR_SEASON, team_id, player_name, position, espn_player_id,
            )
    return owner_id


# ---- query-layer tests -----------------------------------------------------


async def test_get_owner_roster_pool_returns_latest_week_only(pool):
    owner_id = await _seed_owner_with_roster(pool, 1, 501, [(1001, "Old RB", "RB")])
    async with pool.acquire() as conn:
        team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2", _PRIOR_SEASON, owner_id
        )
        # A later week where the roster changed — pool should reflect
        # week 18 (the max), not the week-17 seed above.
        await conn.execute(
            "INSERT INTO rosters (season, week, team_id, player_name, position, lineup_slot, espn_player_id) "
            "VALUES ($1, 18, $2, 'New RB', 'RB', 'RB', 1002)",
            _PRIOR_SEASON, team_id,
        )
        pool_rows = await keeper_queries.get_owner_roster_pool(conn, owner_id, _PRIOR_SEASON)

    names = {r["player_name"] for r in pool_rows}
    assert names == {"New RB"}


async def test_replace_selections_is_a_full_replace(pool):
    owner_id = await _seed_owner_with_roster(pool, 2, 502, [(2001, "Player A", "WR"), (2002, "Player B", "WR")])
    async with pool.acquire() as conn:
        await keeper_queries.replace_selections(
            conn, TEST_SEASON, owner_id, [{"espn_player_id": 2001, "player_name": "Player A"}]
        )
        first = await keeper_queries.get_selections(conn, TEST_SEASON, owner_id)
        assert [r["espn_player_id"] for r in first] == [2001]

        await keeper_queries.replace_selections(
            conn, TEST_SEASON, owner_id, [{"espn_player_id": 2002, "player_name": "Player B"}]
        )
        second = await keeper_queries.get_selections(conn, TEST_SEASON, owner_id)
        assert [r["espn_player_id"] for r in second] == [2002]


# ---- router tests -----------------------------------------------------------


async def test_get_my_keepers_requires_session(pool):
    async with _client() as client:
        resp = await client.get("/keepers/me")
    assert resp.status_code == 401


async def test_keepers_not_open_with_no_rules_configured(pool, monkeypatch):
    _set_env(monkeypatch)
    owner_id = await _seed_owner_with_roster(pool, 3, 503, [(3001, "Player C", "TE")])
    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id))
        resp = await client.get("/keepers/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["rules"]["is_open"] is False
    assert body["rules"]["max_keepers"] == 0


async def test_non_commissioner_cannot_set_rules(pool, monkeypatch):
    _set_env(monkeypatch)
    owner_id = await _seed_owner_with_roster(pool, 4, 504, [])
    async with _client() as client:
        client.cookies.update(_session_cookie(owner_id, is_commissioner=False))
        resp = await client.put("/keepers/rules", json={"season": TEST_SEASON, "max_keepers": 2})
    assert resp.status_code == 403


async def test_owner_can_select_keepers_within_the_cap(pool, monkeypatch):
    _set_env(monkeypatch)
    commissioner_id = await _seed_owner_with_roster(pool, 5, 505, [])
    owner_id = await _seed_owner_with_roster(
        pool, 6, 506, [(6001, "Player D", "RB"), (6002, "Player E", "RB"), (6003, "Player F", "RB")]
    )

    async with _client() as client:
        client.cookies.update(_session_cookie(commissioner_id, is_commissioner=True))
        rules_resp = await client.put("/keepers/rules", json={"season": TEST_SEASON, "max_keepers": 2})
        assert rules_resp.status_code == 200
        assert rules_resp.json()["is_open"] is True

        client.cookies.update(_session_cookie(owner_id))
        # Exceeds the cap.
        too_many = await client.put("/keepers/me", json={"espn_player_ids": [6001, 6002, 6003]})
        assert too_many.status_code == 400

        # A player not on this owner's roster.
        not_mine = await client.put("/keepers/me", json={"espn_player_ids": [9999]})
        assert not_mine.status_code == 400

        ok = await client.put("/keepers/me", json={"espn_player_ids": [6001, 6002]})
        assert ok.status_code == 200
        assert {s["espn_player_id"] for s in ok.json()["selections"]} == {6001, 6002}


async def test_locking_rules_blocks_further_selection_changes(pool, monkeypatch):
    _set_env(monkeypatch)
    commissioner_id = await _seed_owner_with_roster(pool, 7, 507, [])
    owner_id = await _seed_owner_with_roster(pool, 8, 508, [(8001, "Player G", "WR")])

    async with _client() as client:
        client.cookies.update(_session_cookie(commissioner_id, is_commissioner=True))
        await client.put("/keepers/rules", json={"season": TEST_SEASON, "max_keepers": 1})

        client.cookies.update(_session_cookie(owner_id))
        first = await client.put("/keepers/me", json={"espn_player_ids": [8001]})
        assert first.status_code == 200

        client.cookies.update(_session_cookie(commissioner_id, is_commissioner=True))
        lock_resp = await client.post("/keepers/rules/lock", json={"season": TEST_SEASON})
        assert lock_resp.status_code == 200
        assert lock_resp.json()["locked_at"] is not None

        client.cookies.update(_session_cookie(owner_id))
        after_lock = await client.put("/keepers/me", json={"espn_player_ids": []})
        assert after_lock.status_code == 409

        # Rules can't be changed while locked either.
        client.cookies.update(_session_cookie(commissioner_id, is_commissioner=True))
        change_attempt = await client.put("/keepers/rules", json={"season": TEST_SEASON, "max_keepers": 5})
        assert change_attempt.status_code == 409


async def test_consecutive_years_cap_makes_a_player_ineligible(pool, monkeypatch):
    _set_env(monkeypatch)
    commissioner_id = await _seed_owner_with_roster(pool, 9, 509, [])
    owner_id = await _seed_owner_with_roster(pool, 10, 510, [(10001, "Player H", "QB")])

    async with pool.acquire() as conn:
        # This owner already kept Player H last season (consecutive_years_kept=1).
        await keeper_queries.replace_selections(
            conn, _PRIOR_SEASON, owner_id, [{"espn_player_id": 10001, "player_name": "Player H", "consecutive_years_kept": 1}]
        )

    async with _client() as client:
        client.cookies.update(_session_cookie(commissioner_id, is_commissioner=True))
        # Cap of 1 consecutive year — Player H was already kept once, so
        # keeping him again this season would be a 2nd consecutive year.
        await client.put(
            "/keepers/rules", json={"season": TEST_SEASON, "max_keepers": 1, "max_consecutive_years": 1}
        )

        client.cookies.update(_session_cookie(owner_id))
        get_resp = await client.get("/keepers/me")
        pool_entry = next(p for p in get_resp.json()["roster_pool"] if p["espn_player_id"] == 10001)
        assert pool_entry["eligible"] is False

        rejected = await client.put("/keepers/me", json={"espn_player_ids": [10001]})
        assert rejected.status_code == 400
