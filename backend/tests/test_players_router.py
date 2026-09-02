from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.domain import player_card
from app.main import app
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _session_cookie(owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=1, owner_id=owner_id, discord_user_id=900000 + owner_id, is_commissioner=False
    )
    return {"session": token}


async def _get(path, cookies=None, params=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.get(path, params=params)


async def _seed_player(pool, sleeper_id, position="RB", draftable=True):
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable)
            VALUES ($1, $2, $3, $4, 'KC', 'Active', $5)
            """,
            sleeper_id, f"Test Player {sleeper_id}", position, [position], draftable,
        )


async def _seed_owner_with_team(pool, suffix):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-playersrouter-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 9000 + suffix, owner_id, f"Team {suffix}",
        )
    return team_id


async def _seed_roster_entry(pool, team_id, sleeper_player_id):
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, $3, 'BE', 'draft')",
            TEST_SEASON, team_id, sleeper_player_id,
        )


async def test_player_card_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get("/players/whatever/card")
    assert response.status_code == 401


async def test_player_card_404s_for_unknown_player(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get("/players/test-playersrouter-nonexistent/card", cookies=_session_cookie(1))
    assert response.status_code == 404


async def test_player_card_returns_real_shaped_data(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    # Never hits real ESPN — same principle as every other test file
    # here; without this, the router's new name-based ESPN fallback
    # (see player_info.py) would fire a real network call every run.
    monkeypatch.setattr(player_card, "get_player_info", lambda espn_player_id, full_name=None: None)
    await _seed_player(pool, "test-playersrouter-1")

    response = await _get("/players/test-playersrouter-1/card", cookies=_session_cookie(1))

    assert response.status_code == 200
    body = response.json()
    assert body["full_name"] == "Test Player test-playersrouter-1"
    assert body["headshot_url"] == "https://sleepercdn.com/content/nfl/players/test-playersrouter-1.jpg"


async def test_list_players_requires_session():
    response = await _get("/players")
    assert response.status_code == 401


async def test_list_players_rejects_signed_in_account_with_no_league(pool, monkeypatch):
    """is_rostered used to be hardcoded to DEFAULT_LEAGUE_ID regardless
    of the caller's own real league membership — a smaller-severity
    sibling of league.py's finding (2026-09 audit). Now scoped via
    require_active_league_id, a signed-in account with no active league
    at all gets a clean 409, not League 1's rostered/available state."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            "test-playersrouter-nonmember@example.com", "Test PlayersRouter NonMember",
        )
    token = create_session_token(_SESSION_SECRET, user_id=user_id)
    response = await _get("/players", cookies={"session": token})
    assert response.status_code == 409


async def test_list_players_includes_rostered_players_unlike_free_agents(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _seed_player(pool, "test-playersrouter-available")
    await _seed_player(pool, "test-playersrouter-rostered")
    team_id = await _seed_owner_with_team(pool, 1)
    await _seed_roster_entry(pool, team_id, "test-playersrouter-rostered")

    # search="playersrouter" narrows to just these two seeded players —
    # an unfiltered request would sort among every real player in this
    # dev-mirrored DB (thousands, mostly NULL search_rank like these
    # test rows), and the endpoint's LIMIT 300 can't be relied on to
    # include a specific alphabetically-late test row otherwise.
    response = await _get("/players", cookies=_session_cookie(1), params={"search": "playersrouter"})

    assert response.status_code == 200
    by_id = {p["sleeper_player_id"]: p for p in response.json()["players"]}
    assert by_id["test-playersrouter-available"]["is_rostered"] is False
    assert by_id["test-playersrouter-rostered"]["is_rostered"] is True


async def test_list_players_filters_by_position_and_search(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _seed_player(pool, "test-playersrouter-qb", position="QB")
    await _seed_player(pool, "test-playersrouter-wr", position="WR")

    response = await _get("/players", cookies=_session_cookie(1), params={"position": "QB"})
    assert response.status_code == 200
    ids = {p["sleeper_player_id"] for p in response.json()["players"]}
    assert "test-playersrouter-qb" in ids
    assert "test-playersrouter-wr" not in ids

    response = await _get("/players", cookies=_session_cookie(1), params={"search": "playersrouter-wr"})
    assert response.status_code == 200
    ids = {p["sleeper_player_id"] for p in response.json()["players"]}
    assert ids == {"test-playersrouter-wr"}


async def test_list_players_excludes_non_draftable(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    await _seed_player(pool, "test-playersrouter-undraftable", draftable=False)

    response = await _get("/players", cookies=_session_cookie(1))

    assert response.status_code == 200
    ids = {p["sleeper_player_id"] for p in response.json()["players"]}
    assert "test-playersrouter-undraftable" not in ids
