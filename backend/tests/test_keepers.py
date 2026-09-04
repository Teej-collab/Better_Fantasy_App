import datetime
import itertools

from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.main import app
from app.queries import keepers as keeper_queries
from app.queries import leagues as league_queries
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"
_PRIOR_SEASON = TEST_SEASON - 1

_sleeper_id_counter = itertools.count(1)


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _session_cookie(user_id: int, owner_id: int):
    token = create_session_token(
        _SESSION_SECRET, user_id=user_id, owner_id=owner_id, discord_user_id=100000 + owner_id,
        is_commissioner=False,  # ignored by the router now — real per-league check instead
    )
    return {"session": token}


async def _seed_member_with_team(pool, suffix, espn_team_id, role="member"):
    """Real user + owner + team + real DEFAULT_LEAGUE_ID membership —
    keepers.py's commissioner routes now do a live per-league DB check
    (app/auth/league_context.py, see TODO.md's PHASE 9 entry), not the
    old JWT is_commissioner claim, so a fabricated claim with a
    hardcoded user_id=1 (the real production commissioner's own id)
    can no longer stand in for it. Returns (user_id, owner_id, team_id)
    — team_id (teams_by_season's own serial id, not espn_team_id) is
    what current_rosters keys off of, see _seed_roster below."""
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
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) "
            "RETURNING id",
            TEST_SEASON, espn_team_id, owner_id, f"Team {suffix}",
        )
    return user_id, owner_id, team_id


async def _seed_owner_with_team(pool, suffix, espn_team_id):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-keepers-owner-{suffix}", f"Owner {suffix}",
        )
        team_id = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) "
            "RETURNING id",
            TEST_SEASON, espn_team_id, owner_id, f"Team {suffix}",
        )
    return owner_id, team_id


async def _seed_roster(pool, team_id, players):
    """players: list of (espn_player_id, player_name, position) — the
    real roster pool source as of 2026-09-04 (see app/routers/
    keepers.py's own module docstring for why this replaced a live ESPN
    read): a real players row (with BOTH espn_player_id and
    sleeper_player_id — the crosswalk _get_roster_pool joins through)
    plus a real current_rosters row, the exact same table app/domain/
    lineup_engine.py's My Team reads from."""
    async with pool.acquire() as conn:
        for espn_player_id, player_name, position in players:
            sleeper_player_id = f"test-keepers-sleeper-{next(_sleeper_id_counter)}"
            await conn.execute(
                """
                INSERT INTO players (sleeper_player_id, espn_player_id, full_name, position, fantasy_positions,
                                      pro_team, status, is_draftable)
                VALUES ($1, $2, $3, $4, $5, 'KC', 'Active', TRUE)
                """,
                sleeper_player_id, espn_player_id, player_name, position, [position],
            )
            await conn.execute(
                "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
                "VALUES ($1, $2, $3, 'BE', 'draft')",
                TEST_SEASON, team_id, sleeper_player_id,
            )


# ---- query-layer tests -----------------------------------------------------


async def test_replace_selections_is_a_full_replace(pool):
    owner_id, _team_id = await _seed_owner_with_team(pool, 2, 502)
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
    owner_a, _team_a = await _seed_owner_with_team(pool, 11, 511)
    owner_b, _team_b = await _seed_owner_with_team(pool, 12, 512)
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
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    user_id, owner_id, team_id = await _seed_member_with_team(pool, 3, 503)
    await _seed_roster(pool, team_id, [(3001, "Player C", "TE")])

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/keepers/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["rules"]["is_open"] is False
    assert body["rules"]["max_keepers"] == 0


async def test_roster_pool_comes_from_current_rosters(pool, monkeypatch):
    """The whole point of this fix (2026-09-04): the pool reflects this
    app's own real, current in-app roster — a live ESPN read used to
    back this and silently returned nothing for a synthetic
    espn_team_id or a roster that had since diverged from ESPN's own
    copy (see app/routers/keepers.py's module docstring)."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    user_id, owner_id, team_id = await _seed_member_with_team(pool, "live1", 5031)
    await _seed_roster(pool, team_id, [(30011, "Live RB", "RB")])

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/keepers/me")

    assert resp.status_code == 200
    pool_names = {p["player_name"] for p in resp.json()["roster_pool"]}
    assert pool_names == {"Live RB"}


async def test_roster_pool_is_empty_for_a_synthetic_espn_team_id_with_no_roster(pool, monkeypatch):
    """A self-serve-created team (app/queries/teams.py's create_team)
    gets a synthetic, non-real espn_team_id — the old live-ESPN read
    silently returned nothing for these. Confirms the real fix: an
    owner with a team but no current_rosters rows yet (hasn't drafted)
    gets an honestly empty pool, not a crash."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    user_id, owner_id, _team_id = await _seed_member_with_team(pool, "synthetic1", 9999001)

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/keepers/me")

    assert resp.status_code == 200
    assert resp.json()["roster_pool"] == []


async def test_roster_pool_excludes_a_player_with_no_espn_crosswalk(pool, monkeypatch):
    """A player current_rosters carries who has no resolved
    espn_player_id (the Sleeper<->ESPN crosswalk doesn't cover 100% of
    players) can't be tracked as a keeper under this identity scheme —
    left out of the pool rather than shown with a null id."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    user_id, owner_id, team_id = await _seed_member_with_team(pool, "nocrosswalk1", 5051)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, espn_player_id, full_name, position, fantasy_positions, "
            "pro_team, status, is_draftable) VALUES ($1, NULL, $2, $3, $4, 'KC', 'Active', TRUE)",
            "test-keepers-nocrosswalk-1", "No Crosswalk Player", "WR", ["WR"],
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, $3, 'BE', 'draft')",
            TEST_SEASON, team_id, "test-keepers-nocrosswalk-1",
        )

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
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    user_id, owner_id, team_id = await _seed_member_with_team(pool, "sched1", 5041)
    await _seed_roster(pool, team_id, [(30021, "Sched Player", "WR")])

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
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    user_id, owner_id, team_id = await _seed_member_with_team(pool, "sched2", 5042)
    await _seed_roster(pool, team_id, [(30022, "No Draft Yet Player", "WR")])

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/keepers/me")

    assert resp.status_code == 200
    assert resp.json()["rules"]["draft_scheduled_start"] is None


async def test_get_my_keepers_draft_scheduled_start_falls_back_to_pre_set_schedule(pool, monkeypatch):
    """Same fallback as the homepage's Draft Countdown card — a
    commissioner may have set just the date (league_draft_schedule)
    before deciding the draft order at all."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    user_id, owner_id, team_id = await _seed_member_with_team(pool, "sched3", 5043)
    await _seed_roster(pool, team_id, [(30023, "Pre Set Schedule Player", "WR")])

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
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    user_id, owner_id, _team_id = await _seed_member_with_team(pool, 4, 504)
    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.put("/keepers/rules", json={"season": TEST_SEASON, "max_keepers": 2})
    assert resp.status_code == 403


async def test_owner_can_select_keepers_within_the_cap(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    commish_user, commissioner_id, _commish_team_id = await _seed_member_with_team(pool, 5, 505, role="commissioner")
    user_id, owner_id, team_id = await _seed_member_with_team(pool, 6, 506)
    await _seed_roster(
        pool, team_id, [(6001, "Player D", "RB"), (6002, "Player E", "RB"), (6003, "Player F", "RB")]
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
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    commish_user, commissioner_id, _commish_team_id = await _seed_member_with_team(pool, 7, 507, role="commissioner")
    user_id, owner_id, team_id = await _seed_member_with_team(pool, 8, 508)
    await _seed_roster(pool, team_id, [(8001, "Player G", "WR")])

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
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    commish_user, commissioner_id, _commish_team_id = await _seed_member_with_team(pool, 9, 509, role="commissioner")
    user_id, owner_id, team_id = await _seed_member_with_team(pool, 10, 510)
    await _seed_roster(pool, team_id, [(10001, "Player H", "QB")])

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
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    user_id, owner_id, _team_id = await _seed_member_with_team(pool, 11, 511)

    async with _client() as client:
        client.cookies.update(_session_cookie(user_id, owner_id))
        resp = await client.get("/keepers/rules")

    assert resp.status_code == 200
    body = resp.json()
    assert body["season"] == TEST_SEASON
    assert body["max_keepers"] == 0
    assert body["is_open"] is False


async def test_get_keeper_rules_readable_by_any_member_not_just_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    commish_user, commissioner_id, _commish_team_id = await _seed_member_with_team(pool, 12, 512, role="commissioner")
    user_id, owner_id, _team_id = await _seed_member_with_team(pool, 13, 513)

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
