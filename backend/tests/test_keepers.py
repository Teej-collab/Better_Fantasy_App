import datetime

from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.main import app
from app.queries import keepers as keeper_queries
from app.queries import leagues as league_queries
from tests.conftest import TEST_SEASON
from tests.fakes_espn import FakeLeague, make_fake_lineup_player, make_fake_team

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_PRIOR_SEASON = TEST_SEASON - 1


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _session_cookie(user_id: int, owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=user_id, owner_id=owner_id, discord_user_id=100000 + owner_id,
        is_commissioner=False,  # ignored by the router now — real per-league check instead
    )
    return {"session": token}


async def _seed_member_with_team(pool, suffix, espn_team_id, role="member"):
    """Real user + owner + team + real DEFAULT_LEAGUE_ID membership.
    Seeds a team row for BOTH TEST_SEASON and _PRIOR_SEASON, same
    espn_team_id on each — the ordinary continuing-owner shape (see
    app/routers/keepers.py's _get_roster_pool, 2026-09: it resolves
    the prior season's ESPN roster via THIS season's own espn_team_id,
    not by matching owner_id directly across seasons, so a current-
    season row is required for the pool to resolve at all now — see
    test_ownership_handoff_keeper_pool_follows_the_espn_team_id below
    for the case that distinction actually exists for). Returns
    (user_id, owner_id) — pass both into _session_cookie."""
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-keepers-{suffix}@example.com", f"Test User {suffix}",
        )
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            f"test-keepers-owner-{suffix}", f"Owner {suffix}", user_id,
        )
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, role)
        await conn.executemany(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4)",
            [
                (_PRIOR_SEASON, espn_team_id, owner_id, f"Team {suffix}"),
                (TEST_SEASON, espn_team_id, owner_id, f"Team {suffix}"),
            ],
        )
    return user_id, owner_id


def _set_env(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    monkeypatch.setenv("ESPN_LEAGUE_ID", "2027626914")
    monkeypatch.setenv("ESPN_S2", "fake")
    monkeypatch.setenv("ESPN_SWID", "{00000000-FAKE-0000-FAKE-000000000000}")


def _patch_league(monkeypatch, league):
    monkeypatch.setattr("app.providers.espn.lineup_client.League", lambda **kwargs: league)


async def _seed_owner_with_team(pool, suffix, espn_team_id):
    """The keeper pool comes from a live-ish ESPN read for the PRIOR
    season (see app/routers/keepers.py's _get_roster_pool) — this only
    needs a teams_by_season row for that PRIOR season so
    get_team_for_owner can resolve espn_team_id; the actual roster
    content comes from whatever FakeLeague/make_fake_team the caller
    patches in via _patch_league."""
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-keepers-owner-{suffix}", f"Owner {suffix}",
        )
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4)",
            _PRIOR_SEASON, espn_team_id, owner_id, f"Team {suffix}",
        )
    return owner_id


def _fake_roster_league(espn_team_id, players):
    """players: list of (espn_player_id, player_name, position) — built
    into a FakeLeague with one team whose roster has each player
    eligible for their real position + bench, matching a normal
    non-flex-drafted player's real eligible_slots shape closely enough
    for _infer_position to resolve correctly."""
    roster = [
        make_fake_lineup_player(pid, name, position, [position, "BE"])
        for pid, name, position in players
    ]
    team = make_fake_team(espn_team_id, f"ESPN Team {espn_team_id}", "test-member-1", "Alice", "Smith", roster=roster)
    return FakeLeague(teams=[team], current_week=1)


# ---- query-layer tests -----------------------------------------------------


async def test_replace_selections_is_a_full_replace(pool):
    owner_id = await _seed_owner_with_team(pool, 2, 502)
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


async def test_get_all_selections_returns_every_owners_picks(pool):
    owner_a = await _seed_owner_with_team(pool, 11, 511)
    owner_b = await _seed_owner_with_team(pool, 12, 512)
    async with pool.acquire() as conn:
        await keeper_queries.replace_selections(
            conn, TEST_SEASON, owner_a, [{"espn_player_id": 3001, "player_name": "Player A"}]
        )
        await keeper_queries.replace_selections(
            conn, TEST_SEASON, owner_b, [{"espn_player_id": 3002, "player_name": "Player B"}]
        )
        rows = await keeper_queries.get_all_selections(conn, TEST_SEASON)
    assert {r["owner_id"] for r in rows} == {owner_a, owner_b}
    assert {r["espn_player_id"] for r in rows} == {3001, 3002}


# ---- router tests -----------------------------------------------------------


async def test_get_my_keepers_requires_session(pool):
    async with _client() as client:
        resp = await client.get("/keepers/me")
    assert resp.status_code == 401


async def test_keepers_not_open_with_no_rules_configured(pool, monkeypatch):
    _set_env(monkeypatch)
    user_id, owner_id = await _seed_member_with_team(pool, 3, 503)
    _patch_league(monkeypatch, _fake_roster_league(503, [(3001, "Player C", "TE")]))

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/keepers/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["rules"]["is_open"] is False
    assert body["rules"]["max_keepers"] == 0


async def test_roster_pool_comes_from_last_seasons_espn_roster(pool, monkeypatch):
    """The whole point of this fix: the pool reflects LAST season's
    final ESPN roster, not this season's (which is empty for everyone
    pre-draft) and not a live-right-now ESPN read either (which can't
    work for a team that's since moved to a synthetic espn_team_id).
    Confirmed here by never writing anything to teams_by_season for
    the ACTIVE season at all — only the PRIOR season has a team row,
    and the pool still resolves."""
    _set_env(monkeypatch)
    user_id, owner_id = await _seed_member_with_team(pool, "live1", 5031)
    _patch_league(monkeypatch, _fake_roster_league(5031, [(30011, "Live RB", "RB")]))

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/keepers/me")

    assert resp.status_code == 200
    pool_names = {p["player_name"] for p in resp.json()["roster_pool"]}
    assert pool_names == {"Live RB"}


async def test_ownership_handoff_keeper_pool_follows_the_espn_team_id(pool, monkeypatch):
    """The real 2026-09 scenario this fix was built for: a departed
    member's team is handed to a real replacement for the new season —
    same espn_team_id (the real, stable ESPN slot), a genuinely
    different owner_id, and the OLD owner's historical row is left
    completely untouched (the commissioner explicitly did not want any
    historical owner_id/user linkage rewritten — only the roster pool
    itself needed to follow the team). The new owner still gets last
    season's real roster to pick a keeper from."""
    _set_env(monkeypatch)
    shared_espn_team_id = 50999

    # The departed owner's own historical row, PRIOR season only —
    # exactly as it would sit forever, untouched.
    async with pool.acquire() as conn:
        old_owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-keepers-departed-owner", "Departed Owner",
        )
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4)",
            _PRIOR_SEASON, shared_espn_team_id, old_owner_id, "Departed Owner's Old Team",
        )

    # The new owner: a real signed-up member with a CURRENT-season row
    # on that same espn_team_id, but no row of their own for the prior
    # season at all — a fresh account, not a continuing one.
    async with pool.acquire() as conn:
        new_user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            "test-keepers-replacement@example.com", "Replacement Owner",
        )
        new_owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            "test-keepers-owner-replacement", "Replacement Owner", new_user_id,
        )
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, new_user_id, "member")
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4)",
            TEST_SEASON, shared_espn_team_id, new_owner_id, "Replacement Owner's New Team",
        )

    _patch_league(monkeypatch, _fake_roster_league(shared_espn_team_id, [(70011, "Handoff RB", "RB")]))

    async with _client() as client:
        client.cookies.update(_session_cookie(new_user_id, new_owner_id))
        resp = await client.get("/keepers/me")

    assert resp.status_code == 200
    pool_names = {p["player_name"] for p in resp.json()["roster_pool"]}
    assert pool_names == {"Handoff RB"}

    # The departed owner's own historical row is exactly as it was —
    # never touched by any of this.
    async with pool.acquire() as conn:
        old_row = await conn.fetchrow(
            "SELECT owner_id FROM teams_by_season WHERE season = $1 AND espn_team_id = $2",
            _PRIOR_SEASON, shared_espn_team_id,
        )
    assert old_row["owner_id"] == old_owner_id


async def test_roster_pool_is_empty_with_no_prior_season_team(pool, monkeypatch):
    """A genuine new franchise — no team in the prior season at all —
    correctly has nothing to keep from, not an error."""
    _set_env(monkeypatch)
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            "test-keepers-newfranchise@example.com", "New Franchise Owner",
        )
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name, user_id) VALUES ($1, $2, $3) RETURNING owner_id",
            "test-keepers-owner-newfranchise", "New Franchise Owner", user_id,
        )
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "member")
        # No teams_by_season row for this owner in ANY season.

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/keepers/me")

    assert resp.status_code == 200
    assert resp.json()["roster_pool"] == []


async def test_get_my_keepers_includes_draft_scheduled_start(pool, monkeypatch):
    """The owner-facing countdown to auto-lock (KeepersPanel.tsx) needs
    the same scheduled_start DraftCountdownCard.tsx already counts down
    to — this is the one field GET /keepers/me adds on top of the real
    league_keeper_rules row itself."""
    _set_env(monkeypatch)
    user_id, owner_id = await _seed_member_with_team(pool, "sched1", 5041)
    _patch_league(monkeypatch, _fake_roster_league(5041, [(30021, "Sched Player", "WR")]))

    scheduled_start = datetime.datetime(2026, 9, 5, 18, 0, 0, tzinfo=datetime.timezone.utc)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO draft_config (season, draft_order, roster_slots, scheduled_start) "
            "VALUES ($1, $2, $3, $4) ON CONFLICT (season, league_id) DO UPDATE SET scheduled_start = EXCLUDED.scheduled_start",
            TEST_SEASON, [owner_id], "{}", scheduled_start,
        )

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/keepers/me")

    assert resp.status_code == 200
    assert resp.json()["rules"]["draft_scheduled_start"] == "2026-09-05T18:00:00+00:00"


async def test_get_my_keepers_draft_scheduled_start_null_with_no_draft_config(pool, monkeypatch):
    _set_env(monkeypatch)
    user_id, owner_id = await _seed_member_with_team(pool, "sched2", 5042)
    _patch_league(monkeypatch, _fake_roster_league(5042, [(30022, "No Draft Yet Player", "WR")]))

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/keepers/me")

    assert resp.status_code == 200
    assert resp.json()["rules"]["draft_scheduled_start"] is None


async def test_get_my_keepers_draft_scheduled_start_falls_back_to_pre_set_schedule(pool, monkeypatch):
    """Same fallback as the homepage's Draft Countdown card — a
    commissioner may have set just the date (league_draft_schedule)
    before deciding the draft order at all."""
    _set_env(monkeypatch)
    user_id, owner_id = await _seed_member_with_team(pool, "sched3", 5043)
    _patch_league(monkeypatch, _fake_roster_league(5043, [(30023, "Pre Set Schedule Player", "WR")]))

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO league_draft_schedule (season, league_id, scheduled_start) VALUES ($1, 1, $2)",
            TEST_SEASON, datetime.datetime(2026, 9, 5, 18, 0, 0, tzinfo=datetime.timezone.utc),
        )

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/keepers/me")

    assert resp.status_code == 200
    assert resp.json()["rules"]["draft_scheduled_start"] == "2026-09-05T18:00:00+00:00"


async def test_non_commissioner_cannot_set_rules(pool, monkeypatch):
    _set_env(monkeypatch)
    user_id, owner_id = await _seed_member_with_team(pool, 4, 504)
    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.put("/keepers/rules", json={"season": TEST_SEASON, "max_keepers": 2})
    assert resp.status_code == 403


async def test_owner_can_select_keepers_within_the_cap(pool, monkeypatch):
    _set_env(monkeypatch)
    commish_user, commissioner_id = await _seed_member_with_team(pool, 5, 505, role="commissioner")
    user_id, owner_id = await _seed_member_with_team(pool, 6, 506)
    _patch_league(
        monkeypatch,
        _fake_roster_league(506, [(6001, "Player D", "RB"), (6002, "Player E", "RB"), (6003, "Player F", "RB")]),
    )

    async with _client() as client:
        client.cookies.update(_session_cookie(commish_user, commissioner_id))
        rules_resp = await client.put("/keepers/rules", json={"season": TEST_SEASON, "max_keepers": 2})
        assert rules_resp.status_code == 200
        assert rules_resp.json()["is_open"] is True

        client.cookies.update(_session_cookie(user_id, owner_id))
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
    commish_user, commissioner_id = await _seed_member_with_team(pool, 7, 507, role="commissioner")
    user_id, owner_id = await _seed_member_with_team(pool, 8, 508)
    _patch_league(monkeypatch, _fake_roster_league(508, [(8001, "Player G", "WR")]))

    async with _client() as client:
        client.cookies.update(_session_cookie(commish_user, commissioner_id))
        await client.put("/keepers/rules", json={"season": TEST_SEASON, "max_keepers": 1})

        client.cookies.update(_session_cookie(user_id, owner_id))
        first = await client.put("/keepers/me", json={"espn_player_ids": [8001]})
        assert first.status_code == 200

        client.cookies.update(_session_cookie(commish_user, commissioner_id))
        lock_resp = await client.post("/keepers/rules/lock", json={"season": TEST_SEASON})
        assert lock_resp.status_code == 200
        assert lock_resp.json()["locked_at"] is not None

        client.cookies.update(_session_cookie(user_id, owner_id))
        after_lock = await client.put("/keepers/me", json={"espn_player_ids": []})
        assert after_lock.status_code == 409

        # Rules can't be changed while locked either.
        client.cookies.update(_session_cookie(commish_user, commissioner_id))
        change_attempt = await client.put("/keepers/rules", json={"season": TEST_SEASON, "max_keepers": 5})
        assert change_attempt.status_code == 409


async def test_consecutive_years_cap_makes_a_player_ineligible(pool, monkeypatch):
    _set_env(monkeypatch)
    commish_user, commissioner_id = await _seed_member_with_team(pool, 9, 509, role="commissioner")
    user_id, owner_id = await _seed_member_with_team(pool, 10, 510)
    _patch_league(monkeypatch, _fake_roster_league(510, [(10001, "Player H", "QB")]))

    async with pool.acquire() as conn:
        # This owner already kept Player H last season (consecutive_years_kept=1).
        await keeper_queries.replace_selections(
            conn, _PRIOR_SEASON, owner_id, [{"espn_player_id": 10001, "player_name": "Player H", "consecutive_years_kept": 1}]
        )

    async with _client() as client:
        client.cookies.update(_session_cookie(commish_user, commissioner_id))
        # Cap of 1 consecutive year — Player H was already kept once, so
        # keeping him again this season would be a 2nd consecutive year.
        await client.put(
            "/keepers/rules", json={"season": TEST_SEASON, "max_keepers": 1, "max_consecutive_years": 1}
        )

        client.cookies.update(_session_cookie(user_id, owner_id))
        get_resp = await client.get("/keepers/me")
        pool_entry = next(p for p in get_resp.json()["roster_pool"] if p["espn_player_id"] == 10001)
        assert pool_entry["eligible"] is False

        rejected = await client.put("/keepers/me", json={"espn_player_ids": [10001]})
        assert rejected.status_code == 400


async def test_get_keeper_rules_requires_session():
    async with _client() as client:
        resp = await client.get("/keepers/rules")
    assert resp.status_code == 401


async def test_get_keeper_rules_reads_open_default_for_a_season_with_none_set(pool, monkeypatch):
    _set_env(monkeypatch)
    user_id, owner_id = await _seed_member_with_team(pool, 11, 511)

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/keepers/rules")

    assert resp.status_code == 200
    body = resp.json()
    assert body["season"] == TEST_SEASON
    assert body["max_keepers"] == 0
    assert body["is_open"] is False


async def test_get_keeper_rules_readable_by_any_member_not_just_commissioner(pool, monkeypatch):
    _set_env(monkeypatch)
    commish_user, commissioner_id = await _seed_member_with_team(pool, 12, 512, role="commissioner")
    user_id, owner_id = await _seed_member_with_team(pool, 13, 513)

    async with _client() as client:
        client.cookies.update(_session_cookie(commish_user, commissioner_id))
        set_resp = await client.put(
            "/keepers/rules", json={"season": TEST_SEASON, "max_keepers": 3, "max_consecutive_years": 2}
        )
        assert set_resp.status_code == 200

        # A plain member (not the commissioner) can still read the
        # rules — this is the pre-fill read the commissioner UI itself
        # also uses, and read access was deliberately left open (mirrors
        # GET /league/scoring-rules), not commissioner-gated.
        client.cookies.update(_session_cookie(user_id, owner_id))
        get_resp = await client.get("/keepers/rules")

    assert get_resp.status_code == 200
    body = get_resp.json()
    assert body["max_keepers"] == 3
    assert body["max_consecutive_years"] == 2
