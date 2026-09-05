from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app
from app.queries import leagues as league_queries
from app.config import DEFAULT_LEAGUE_ID

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _session_cookie(user_id: int, owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=user_id, owner_id=owner_id, discord_user_id=900000 + owner_id,
        is_commissioner=False,  # ignored by the router now — real per-league check instead
    )
    return {"session": token}


async def _make_user(conn, suffix: str) -> int:
    return await conn.fetchval(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
        f"test-admin-{suffix}@example.com", f"Test Admin {suffix}",
    )


async def _non_commissioner_cookies(pool, suffix: str) -> dict:
    """A real, isolated test user who is not a League #1 commissioner —
    admin.py's routes gate on require_commissioner_of(DEFAULT_LEAGUE_ID)
    specifically, a live DB check (see TODO.md's PHASE 9 entry), not
    the old JWT is_commissioner claim these tests used to fake. Using
    a real but unaffiliated user (rather than the real production
    commissioner's own user_id) keeps a "rejects" test from silently
    succeeding — and, worse, actually firing a real unmocked ESPN
    sync — just because it happened to reuse a real commissioner's id."""
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, suffix)
    return _session_cookie(user_id, owner_id=1)


async def _commissioner_of_league_one_cookies(pool, suffix: str) -> dict:
    """A real test user actually made League #1's commissioner for the
    duration of one test — the only way to legitimately exercise the
    success path now that this is a live per-league DB check rather
    than a JWT flag. Cleaned up by conftest's league_members-by-user
    sweep (this user's email matches 'test-%')."""
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, suffix)
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "commissioner")
    return _session_cookie(user_id, owner_id=1)


async def _post_sync(cookies=None, path="/admin/sync", json=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.post(path, json=json)


async def _get(cookies=None, path="/admin/online"):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.get(path)


async def _patch(cookies=None, path="/admin/online", json=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.patch(path, json=json)


async def _explicit_admin_cookies(pool, suffix: str) -> dict:
    """A real test user with users.is_admin=TRUE directly, NOT a League
    #1 commissioner — proves require_site_admin's grant actually works
    on its own, not just via league role (see app/auth/league_context.py's
    is_site_admin)."""
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, suffix)
        await conn.execute("UPDATE users SET is_admin = TRUE WHERE id = $1", user_id)
    return _session_cookie(user_id, owner_id=1)


async def test_sync_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync()
    assert response.status_code == 401


async def test_sync_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(cookies=await _non_commissioner_cookies(pool, "sync-reject"))
    assert response.status_code == 403


async def test_live_sync_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(path="/admin/sync/live")
    assert response.status_code == 401


async def test_live_sync_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(
        cookies=await _non_commissioner_cookies(pool, "live-sync-reject"), path="/admin/sync/live"
    )
    assert response.status_code == 403


async def test_weekly_compute_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(path="/admin/weekly-compute")
    assert response.status_code == 401


async def test_weekly_compute_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(
        cookies=await _non_commissioner_cookies(pool, "weekly-compute-reject"), path="/admin/weekly-compute"
    )
    assert response.status_code == 403


async def test_bye_week_sync_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(path="/admin/sync/bye-weeks")
    assert response.status_code == 401


async def test_bye_week_sync_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(
        cookies=await _non_commissioner_cookies(pool, "bye-week-reject"), path="/admin/sync/bye-weeks"
    )
    assert response.status_code == 403


async def test_bye_week_sync_writes_real_rows(pool, monkeypatch):
    from app.domain import bye_weeks as bye_weeks_module
    from tests.conftest import TEST_SEASON

    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    monkeypatch.setenv("ESPN_LEAGUE_ID", "2027626914")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "{00000000-FAKE-0000-FAKE-000000000000}")

    async def fake_scoreboard(week, year, season_type=None):
        return [{"home_team": "KC", "away_team": "SF"}] if week == 1 else [{"home_team": "SF", "away_team": "ZZZ"}]

    monkeypatch.setattr(bye_weeks_module, "get_week_scoreboard", fake_scoreboard)
    monkeypatch.setattr(bye_weeks_module, "REGULAR_SEASON_WEEKS", 2)

    response = await _post_sync(
        cookies=await _commissioner_of_league_one_cookies(pool, "bye-week-writer"), path="/admin/sync/bye-weeks"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["teams_synced"] == 1  # only KC has exactly one missing week in this fixture


async def test_projected_points_sync_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(path="/admin/players/sync-projections")
    assert response.status_code == 401


async def test_projected_points_sync_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(
        cookies=await _non_commissioner_cookies(pool, "proj-sync-reject"), path="/admin/players/sync-projections"
    )
    assert response.status_code == 403


async def test_projected_points_sync_writes_real_rows(pool, monkeypatch):
    from app.domain import player_projections

    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, espn_player_id, full_name, position, is_draftable) "
            "VALUES ('test-admin-proj-player', 777001, 'Test Admin Proj Player', 'RB', TRUE)"
        )

    monkeypatch.setattr(
        player_projections,
        "get_all_projected_points",
        lambda config=None, season=None: [
            {"espn_player_id": 777001, "name": "Test Admin Proj Player", "projected_points": 199.9}
        ],
    )

    response = await _post_sync(
        cookies=await _commissioner_of_league_one_cookies(pool, "proj-sync-writer"),
        path="/admin/players/sync-projections",
    )

    assert response.status_code == 200
    assert response.json()["matched_by_espn_id"] == 1

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT projected_points FROM players WHERE sleeper_player_id = 'test-admin-proj-player'"
        )
    assert float(row["projected_points"]) == 199.9


# ---- Usage dashboard (2026-09) --------------------------------------


class _FakeSocket:
    async def accept(self):
        pass

    async def send_json(self, message):
        pass


async def test_online_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(path="/admin/online")
    assert response.status_code == 401


async def test_online_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(cookies=await _non_commissioner_cookies(pool, "online-reject"), path="/admin/online")
    assert response.status_code == 403


async def test_online_reports_username_only_for_connected_owners(pool, monkeypatch):
    from app.chat.manager import manager as chat_manager

    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-admin-online-owner", "Online Owner",
        )

    await chat_manager.connect(owner_id, _FakeSocket())
    try:
        response = await _get(
            cookies=await _commissioner_of_league_one_cookies(pool, "online-reader"), path="/admin/online"
        )
    finally:
        await chat_manager.disconnect(owner_id, list(chat_manager._connections[owner_id])[0])

    assert response.status_code == 200
    owners = response.json()["owners"]
    assert owners == [{"owner_id": owner_id, "display_name": "Online Owner"}]


async def test_track_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post_sync(
        path="/admin/track",
        json={"session_id": "s1", "event_name": "nav_standings", "event_type": "page_view", "route": "/standings"},
    )
    assert response.status_code == 401


async def test_track_records_a_real_row_tagged_with_the_callers_own_owner_id(pool, monkeypatch):
    """owner_id is never accepted from the request body at all — the
    row it lands under always matches whoever the SESSION says is
    calling, never anything a client could claim to be."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, "track")
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            "test-admin-track-owner", "Track Owner", user_id,
        )
    cookies = _session_cookie(user_id, owner_id)

    response = await _post_sync(
        cookies=cookies,
        path="/admin/track",
        json={
            "session_id": "test-session-1",
            "event_name": "nav_standings",
            "event_type": "page_view",
            "route": "/standings",
            "device_type": "mobile",
            "platform": "ios",
        },
    )
    assert response.status_code == 200

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT event_name, event_type, route, device_type, platform FROM analytics_events WHERE owner_id = $1",
            owner_id,
        )
    assert row["event_name"] == "nav_standings"
    assert row["event_type"] == "page_view"
    assert row["route"] == "/standings"
    assert row["device_type"] == "mobile"
    assert row["platform"] == "ios"


async def test_track_is_a_noop_without_an_owner_id(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, "track-noowner")
    token = create_session_token(_SESSION_SECRET, user_id=user_id)  # no owner_id — hasn't joined a league yet

    response = await _post_sync(
        cookies={"session": token},
        path="/admin/track",
        json={"session_id": "s1", "event_name": "nav_home", "event_type": "page_view"},
    )
    assert response.status_code == 200

    async with pool.acquire() as conn:
        count = await conn.fetchval("SELECT count(*) FROM analytics_events WHERE session_id = 's1'")
    assert count == 0


async def test_track_rejects_an_unknown_event_name(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, "track-badname")
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            "test-admin-track-badname-owner", "Bad Name Owner", user_id,
        )
    response = await _post_sync(
        cookies=_session_cookie(user_id, owner_id),
        path="/admin/track",
        json={"session_id": "s1", "event_name": "not_a_real_event", "event_type": "page_view"},
    )
    assert response.status_code == 400


async def test_track_rejects_a_feature_event_with_a_disallowed_metadata_key(pool, monkeypatch):
    """league_switched only accepts to_league_id — a client trying to
    smuggle anything else through metadata (an arbitrary key, or a
    completely different key name) gets rejected outright, not
    silently stripped or accepted."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, "track-badmeta")
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            "test-admin-track-badmeta-owner", "Bad Meta Owner", user_id,
        )
    response = await _post_sync(
        cookies=_session_cookie(user_id, owner_id),
        path="/admin/track",
        json={
            "session_id": "s1",
            "event_name": "league_switched",
            "event_type": "feature",
            "metadata": {"to_league_id": 1, "password": "smuggled"},
        },
    )
    assert response.status_code == 400


async def test_track_rejects_a_page_view_event_name_that_is_actually_a_feature_name(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, "track-typemismatch")
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            "test-admin-track-typemismatch-owner", "Type Mismatch Owner", user_id,
        )
    response = await _post_sync(
        cookies=_session_cookie(user_id, owner_id),
        path="/admin/track",
        json={"session_id": "s1", "event_name": "league_switched", "event_type": "page_view"},
    )
    assert response.status_code == 400


async def test_overview_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    assert (await _get(path="/admin/overview")).status_code == 401


async def test_overview_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(cookies=await _non_commissioner_cookies(pool, "overview-reject"), path="/admin/overview")
    assert response.status_code == 403


async def test_overview_reports_real_counts(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-admin-overview-owner", "Overview Owner",
        )
        await conn.execute(
            "INSERT INTO analytics_events (owner_id, session_id, event_name, event_type) "
            "VALUES ($1, 's1', 'nav_home', 'page_view')",
            owner_id,
        )

    response = await _get(
        cookies=await _commissioner_of_league_one_cookies(pool, "overview-reader"), path="/admin/overview?days=7"
    )
    assert response.status_code == 200
    body = response.json()
    assert body["window_days"] == 7
    assert body["total_users"] >= 1
    assert body["active_users"] >= 1
    assert "online_now" in body


async def test_navigation_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(
        cookies=await _non_commissioner_cookies(pool, "navigation-reject"), path="/admin/navigation"
    )
    assert response.status_code == 403


async def test_navigation_summarizes_real_page_views(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-admin-navigation-owner", "Navigation Owner",
        )
        await conn.execute(
            "INSERT INTO analytics_events (owner_id, session_id, event_name, event_type) VALUES "
            "($1, 's1', 'nav_standings', 'page_view'), ($1, 's1', 'nav_standings', 'page_view'), "
            "($1, 's1', 'nav_chat', 'page_view')",
            owner_id,
        )

    response = await _get(
        cookies=await _commissioner_of_league_one_cookies(pool, "navigation-reader"), path="/admin/navigation?days=7"
    )
    assert response.status_code == 200
    body = response.json()
    routes = {r["event_name"]: r["views"] for r in body["routes"]}
    # >=, not == — this query is a genuinely global aggregate over the
    # whole analytics_events table (real production traffic, not test-
    # isolated), so real concurrent usage can only ever add to these
    # counts, never subtract from them.
    assert routes["nav_standings"] >= 2
    assert routes["nav_chat"] >= 1


async def test_users_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(cookies=await _non_commissioner_cookies(pool, "users-reject"), path="/admin/users")
    assert response.status_code == 403


async def test_users_search_finds_by_display_name(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2)",
            "test-admin-searchable@example.com", "Zzyzx Searchable User",
        )
    response = await _get(
        cookies=await _commissioner_of_league_one_cookies(pool, "users-searcher"),
        path="/admin/users?search=Zzyzx+Searchable",
    )
    assert response.status_code == 200
    names = [u["display_name"] for u in response.json()["users"]]
    assert "Zzyzx Searchable User" in names


async def test_user_detail_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(cookies=await _non_commissioner_cookies(pool, "userdetail-reject"), path="/admin/users/1")
    assert response.status_code == 403


async def test_user_detail_404s_for_an_unknown_user(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(
        cookies=await _commissioner_of_league_one_cookies(pool, "userdetail-404"), path="/admin/users/999999999"
    )
    assert response.status_code == 404


async def test_user_detail_never_includes_password_hash_or_secrets(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        target_user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'super-secret-hash', $2) RETURNING id",
            "test-admin-secretcheck@example.com", "Secret Check User",
        )
    response = await _get(
        cookies=await _commissioner_of_league_one_cookies(pool, "userdetail-secretcheck"),
        path=f"/admin/users/{target_user_id}",
    )
    assert response.status_code == 200
    body_text = response.text
    assert "super-secret-hash" not in body_text
    assert "password_hash" not in body_text
    assert "password" not in body_text.lower()


async def test_leagues_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(cookies=await _non_commissioner_cookies(pool, "leagues-reject"), path="/admin/leagues")
    assert response.status_code == 403


async def test_league_detail_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(
        cookies=await _non_commissioner_cookies(pool, "leaguedetail-reject"), path="/admin/leagues/1"
    )
    assert response.status_code == 403


async def test_league_detail_404s_for_an_unknown_league(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(
        cookies=await _commissioner_of_league_one_cookies(pool, "leaguedetail-404"), path="/admin/leagues/999999999"
    )
    assert response.status_code == 404


async def test_league_detail_lists_real_members(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        creator_user_id = await _make_user(conn, "leaguedetail-creator")
    from app.queries import leagues as league_queries

    async with pool.acquire() as conn:
        league_id = await league_queries.create_league(
            conn, "Test League Admin Detail", creator_user_id, "admin-detail-code"
        )
        await league_queries.add_member(conn, league_id, creator_user_id, "commissioner")

    response = await _get(
        cookies=await _commissioner_of_league_one_cookies(pool, "leaguedetail-reader"),
        path=f"/admin/leagues/{league_id}",
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Test League Admin Detail"
    member_user_ids = [m["user_id"] for m in body["members"]]
    assert creator_user_id in member_user_ids


# ---- Independent admin grants (2026-09) -------------------------------


async def test_explicit_admin_grant_can_read_the_dashboard_without_being_a_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(cookies=await _explicit_admin_cookies(pool, "explicitadmin-reader"), path="/admin/online")
    assert response.status_code == 200


async def test_set_is_admin_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _patch(path="/admin/users/1/admin", json={"is_admin": True})
    assert response.status_code == 401


async def test_set_is_admin_rejects_non_admin(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        target_user_id = await _make_user(conn, "grant-target-reject")
    response = await _patch(
        cookies=await _non_commissioner_cookies(pool, "grant-rejector"),
        path=f"/admin/users/{target_user_id}/admin",
        json={"is_admin": True},
    )
    assert response.status_code == 403


async def test_set_is_admin_grants_and_revokes_a_real_row(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        target_user_id = await _make_user(conn, "grant-target")
    admin_cookies = await _commissioner_of_league_one_cookies(pool, "grantor")

    grant = await _patch(cookies=admin_cookies, path=f"/admin/users/{target_user_id}/admin", json={"is_admin": True})
    assert grant.status_code == 200
    assert grant.json()["is_admin"] is True

    async with pool.acquire() as conn:
        row = await conn.fetchval("SELECT is_admin FROM users WHERE id = $1", target_user_id)
    assert row is True

    revoke = await _patch(cookies=admin_cookies, path=f"/admin/users/{target_user_id}/admin", json={"is_admin": False})
    assert revoke.status_code == 200
    assert revoke.json()["is_admin"] is False


async def test_set_is_admin_cannot_target_your_own_row(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, "grant-self")
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "commissioner")
    response = await _patch(
        cookies=_session_cookie(user_id, owner_id=1), path=f"/admin/users/{user_id}/admin", json={"is_admin": False}
    )
    assert response.status_code == 400


async def test_set_is_admin_404s_for_an_unknown_user(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _patch(
        cookies=await _commissioner_of_league_one_cookies(pool, "grant-404"),
        path="/admin/users/999999999/admin",
        json={"is_admin": True},
    )
    assert response.status_code == 404


async def test_timeseries_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(path="/admin/timeseries")
    assert response.status_code == 401


async def test_timeseries_rejects_non_admin(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(cookies=await _non_commissioner_cookies(pool, "timeseries-reject"), path="/admin/timeseries")
    assert response.status_code == 403


async def test_timeseries_is_zero_filled_for_every_day_in_the_window(pool, monkeypatch):
    """The real point of generate_series in admin_overview.get_timeseries
    — a quiet day with no signups/events still gets a real 0 row, not a
    gap, since a line chart needs every x-axis point to actually exist."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(cookies=await _commissioner_of_league_one_cookies(pool, "timeseries-ok"), path="/admin/timeseries?days=7")
    assert response.status_code == 200
    body = response.json()
    assert body["window_days"] == 7
    assert len(body["days"]) == 8  # inclusive of both endpoints, matches generate_series
    for day in body["days"]:
        assert set(day.keys()) == {"day", "signups", "events", "active_owners"}


async def test_activity_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(path="/admin/activity")
    assert response.status_code == 401


async def test_activity_rejects_non_admin(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(cookies=await _non_commissioner_cookies(pool, "activity-reject"), path="/admin/activity")
    assert response.status_code == 403


async def test_activity_includes_a_real_new_signup(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        await _make_user(conn, "activity-signup")
    response = await _get(cookies=await _commissioner_of_league_one_cookies(pool, "activity-ok"), path="/admin/activity?limit=50")
    assert response.status_code == 200
    kinds = {item["kind"] for item in response.json()["activity"]}
    assert "signup" in kinds


async def test_alerts_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(path="/admin/alerts")
    assert response.status_code == 401


async def test_alerts_rejects_non_admin(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(cookies=await _non_commissioner_cookies(pool, "alerts-reject"), path="/admin/alerts")
    assert response.status_code == 403


async def test_alerts_flags_an_unclaimed_owner_with_a_real_team(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-admin-alerts-unclaimed", "Alerts Unclaimed Owner",
        )
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
            "VALUES (1900, nextval('synthetic_espn_team_id_seq'), $1, 'Alerts FC', $2)",
            owner_id, DEFAULT_LEAGUE_ID,
        )
    response = await _get(cookies=await _commissioner_of_league_one_cookies(pool, "alerts-ok"), path="/admin/alerts")
    assert response.status_code == 200
    messages = " ".join(a["message"] for a in response.json()["alerts"])
    assert "not yet claimed" in messages


async def test_system_health_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(path="/admin/system-health")
    assert response.status_code == 401


async def test_system_health_rejects_non_admin(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(cookies=await _non_commissioner_cookies(pool, "health-reject"), path="/admin/system-health")
    assert response.status_code == 403


async def test_system_health_reports_real_live_signals(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get(cookies=await _commissioner_of_league_one_cookies(pool, "health-ok"), path="/admin/system-health")
    assert response.status_code == 200
    body = response.json()
    assert body["db"]["reachable"] is True
    assert body["db"]["pool_size"] >= 1
    assert body["uptime_seconds"] >= 0
    assert set(body["websocket_connections"].keys()) == {"chat", "draft", "gamecast"}
