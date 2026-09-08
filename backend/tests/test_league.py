from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import DEFAULT_LEAGUE_ID
from app.main import app
from app.queries import leagues as league_queries
from tests.conftest import TEST_SEASON

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _session_cookie(user_id: int) -> dict:
    token = create_session_token(_SESSION_SECRET, user_id=user_id)
    return {"session": token}


async def _member_cookies(pool, suffix: str) -> dict:
    """A real, isolated test user made a League #1 member — every
    endpoint in league.py now requires real active-league membership
    (require_league_access, 2026-09 audit), so exercising any success
    path needs a real member, not an unauthenticated call the way these
    tests used to work before that fix."""
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-league-router-{suffix}@example.com", f"Test League {suffix}",
        )
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "member")
    return _session_cookie(user_id)


async def _non_member_cookies(pool, suffix: str) -> dict:
    """A real, isolated test user who belongs to NO league at all —
    the actual attacker scenario from the 2026-09 audit (a "Test"
    account could see League #1's full standings/rosters without ever
    joining)."""
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
            f"test-league-router-nonmember-{suffix}@example.com", f"Test NonMember {suffix}",
        )
    return _session_cookie(user_id)


async def _get(path, cookies=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.get(path)


async def _seed_two_teams(pool):
    async with pool.acquire() as conn:
        owner_a = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-league-owner-a", "Alice Smith",
        )
        owner_b = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-league-owner-b", "Bob Jones",
        )
        team_a = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 101, owner_a, "Team Alpha",
        )
        team_b = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 102, owner_b, "Team Beta",
        )
    return team_a, team_b


async def test_seasons_and_teams(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, team_b = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "seasons-teams")

    resp = await _get("/seasons")
    assert resp.status_code == 200
    assert TEST_SEASON in resp.json()["seasons"]

    resp = await _get(f"/seasons/{TEST_SEASON}/teams", cookies)
    assert resp.status_code == 200
    names = {t["team_name"] for t in resp.json()["teams"]}
    assert names == {"Team Alpha", "Team Beta"}


async def test_league_endpoints_require_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    for path in (
        f"/seasons/{TEST_SEASON}/teams",
        f"/seasons/{TEST_SEASON}/standings",
        f"/seasons/{TEST_SEASON}/weeks/1/matchups",
        "/records",
        "/rivalries",
        "/teams/1",
        "/teams/1/roster?week=1",
        "/matchups/1",
        f"/seasons/{TEST_SEASON}/waivers/priority?week=1",
    ):
        resp = await _get(path)
        assert resp.status_code == 401, f"{path} should require a session"


async def test_league_endpoints_reject_non_member(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _non_member_cookies(pool, "reject")
    for path in (
        f"/seasons/{TEST_SEASON}/teams",
        f"/seasons/{TEST_SEASON}/standings",
        f"/seasons/{TEST_SEASON}/weeks/1/matchups",
        "/records",
        "/rivalries",
        f"/seasons/{TEST_SEASON}/waivers/priority?week=1",
    ):
        resp = await _get(path, cookies)
        # require_active_league_id 409s a signed-in account with no
        # active league at all — never 200, never real League 1 data.
        assert resp.status_code == 409, f"{path} should reject a non-member"


async def test_playoff_bracket_empty_before_generation(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _member_cookies(pool, "bracket-empty")

    resp = await _get(f"/seasons/{TEST_SEASON}/playoffs/bracket", cookies)

    assert resp.status_code == 200
    assert resp.json()["nodes"] == []


async def test_playoff_bracket_reflects_generated_bracket(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, team_b = await _seed_two_teams(pool)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
            "VALUES ($1, 1, $2, $3, $4, $5)",
            TEST_SEASON, team_a, team_b, 10, 20,
        )
        await conn.execute(
            "INSERT INTO league_playoff_settings (season, league_id, playoff_team_count) VALUES ($1, $2, 2)",
            TEST_SEASON, DEFAULT_LEAGUE_ID,
        )
        from app.domain.playoffs import generate_playoff_bracket

        await generate_playoff_bracket(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
    cookies = await _member_cookies(pool, "bracket-generated")

    resp = await _get(f"/seasons/{TEST_SEASON}/playoffs/bracket", cookies)

    assert resp.status_code == 200
    nodes = resp.json()["nodes"]
    assert len(nodes) == 1
    assert {nodes[0]["team_a_name"], nodes[0]["team_b_name"]} == {"Team Alpha", "Team Beta"}


async def test_waiver_priority_seeds_worst_record_first(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, team_b = await _seed_two_teams(pool)
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score) "
            "VALUES ($1, 1, $2, $3, $4, $5)",
            TEST_SEASON, team_a, team_b, 10, 20,
        )
    cookies = await _member_cookies(pool, "waiver-priority")

    resp = await _get(f"/seasons/{TEST_SEASON}/waivers/priority?week=2", cookies)

    assert resp.status_code == 200
    body = resp.json()
    assert body["week"] == 2
    by_team = {row["team_id"]: row["priority"] for row in body["priority_order"]}
    assert by_team[team_a] < by_team[team_b]  # team_a lost, so it picks first


async def test_team_and_roster_404_for_non_member_even_with_valid_ids(pool, monkeypatch):
    """The exact IDOR shape the audit asked for: a real team_id/matchup_id
    that exists, requested by someone who isn't a League #1 member at
    all (has no active league, so this can't even resolve to "a
    different league" — the simplest, strictest denial)."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, _ = await _seed_two_teams(pool)
    async with pool.acquire() as conn:
        matchup_id = await conn.fetchval(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 1, $2, $2, 1.0, 1.0, FALSE) RETURNING id",
            TEST_SEASON, team_a,
        )
    cookies = await _non_member_cookies(pool, "team-roster")

    assert (await _get(f"/teams/{team_a}", cookies)).status_code == 409
    assert (await _get(f"/teams/{team_a}/roster?week=1", cookies)).status_code == 409
    assert (await _get(f"/matchups/{matchup_id}", cookies)).status_code == 409


async def test_standings_computed_from_matchups(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, team_b = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "standings-computed")

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 1, $2, $3, 120.5, 100.0, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/standings", cookies)
    assert resp.status_code == 200
    standings = {row["team_id"]: row for row in resp.json()["standings"]}

    assert standings[team_a]["wins"] == 1
    assert standings[team_a]["losses"] == 0
    assert float(standings[team_a]["points_for"]) == 120.5

    assert standings[team_b]["wins"] == 0
    assert standings[team_b]["losses"] == 1
    assert float(standings[team_b]["points_for"]) == 100.0


async def test_standings_playoff_team_count_is_none_with_no_prior_playoff_data(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "playoff-none")

    resp = await _get(f"/seasons/{TEST_SEASON}/standings", cookies)
    assert resp.status_code == 200
    assert resp.json()["playoff_team_count"] is None


async def test_standings_playoff_team_count_from_most_recent_prior_season(pool, monkeypatch):
    """A brand-new season's standings page has no playoff bracket of
    its own yet — the "playoff line" it shows has to come from the
    real, most recently completed prior season's own bracket
    (matchups.is_playoff), not a guess."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _member_cookies(pool, "playoff-prior")
    prior_season = TEST_SEASON - 1
    async with pool.acquire() as conn:
        owners = []
        teams = []
        for i in range(4):
            owner_id = await conn.fetchval(
                "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
                f"test-league-playoff-owner-{i}", f"Playoff Owner {i}",
            )
            team_id = await conn.fetchval(
                "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
                prior_season, 200 + i, owner_id, f"Playoff Team {i}",
            )
            owners.append(owner_id)
            teams.append(team_id)

        # 2 playoff matchups among the 4 teams — a real 4-team bracket.
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 15, $2, $3, 100.0, 90.0, TRUE)",
            prior_season, teams[0], teams[1],
        )
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff) "
            "VALUES ($1, 15, $2, $3, 80.0, 70.0, TRUE)",
            prior_season, teams[2], teams[3],
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/standings", cookies)
    assert resp.status_code == 200
    assert resp.json()["playoff_team_count"] == 4


async def test_standings_ordered_by_final_rank_when_present(pool, monkeypatch):
    # Real-world case this guards against: 2024's actual champion was
    # seeded 4th by regular-season record. final_standings (ESPN's own
    # computed final rank) must win over win/loss ordering.
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, team_b = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "final-rank")

    async with pool.acquire() as conn:
        # Team A has the worse record...
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 1, $3, $2, 130.0, 90.0, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )
        # ...but won the championship (final_rank 1), so should rank first.
        await conn.execute(
            "INSERT INTO final_standings (season, team_id, final_rank) VALUES ($1, $2, 1)",
            TEST_SEASON, team_a,
        )
        await conn.execute(
            "INSERT INTO final_standings (season, team_id, final_rank) VALUES ($1, $2, 2)",
            TEST_SEASON, team_b,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/standings", cookies)
    body = resp.json()["standings"]
    assert [row["team_id"] for row in body] == [team_a, team_b]
    assert body[0]["final_rank"] == 1
    assert body[0]["wins"] == 0  # confirms it's really final_rank driving order, not win/loss


async def test_standings_falls_back_to_record_when_no_final_rank(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, team_b = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "fallback-record")

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 1, $2, $3, 130.0, 90.0, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/standings", cookies)
    body = resp.json()["standings"]
    assert body[0]["team_id"] == team_a
    assert body[0]["final_rank"] is None


async def test_standings_excludes_unplayed_zero_zero_games(pool, monkeypatch):
    # ESPN returns 0/0 (not NULL) for matchups that haven't been played
    # yet — a 0-0 "tie" should not be counted.
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, team_b = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "excludes-zero")

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 1, $2, $3, 110.0, 90.0, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )
        await conn.execute(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 2, $2, $3, 0, 0, FALSE)
            """,
            TEST_SEASON, team_a, team_b,
        )

    resp = await _get(f"/seasons/{TEST_SEASON}/standings", cookies)
    standings = {row["team_id"]: row for row in resp.json()["standings"]}

    assert standings[team_a]["wins"] == 1
    assert standings[team_a]["losses"] == 0
    assert standings[team_a]["ties"] == 0
    assert standings[team_b]["wins"] == 0
    assert standings[team_b]["losses"] == 1
    assert standings[team_b]["ties"] == 0


async def test_roster_ordered_like_espn_lineup(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, _ = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "roster-order")

    async with pool.acquire() as conn:
        # Insert deliberately out of order to prove sorting, not insert order.
        for idx, (name, slot) in enumerate([
            ("Bench Guy", "BE"),
            ("Kicker", "K"),
            ("Flex Guy", "RB/WR/TE"),
            ("Tight End", "TE"),
            ("Wide Out 2", "WR"),
            ("Wide Out 1", "WR"),
            ("Running Back 2", "RB"),
            ("Running Back 1", "RB"),
            ("Quarterback", "QB"),
            ("IR Guy", "IR"),
            ("Defense", "D/ST"),
        ]):
            sleeper_id = f"test-lg-roster-order-{idx}"
            await conn.execute(
                "INSERT INTO players (sleeper_player_id, full_name, position, is_draftable, projected_avg_points) "
                "VALUES ($1, $2, 'X', TRUE, 1.0)",
                sleeper_id, name,
            )
            await conn.execute(
                "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
                "VALUES ($1, $2, $3, $4, 'draft')",
                TEST_SEASON, team_a, sleeper_id, slot,
            )

    resp = await _get(f"/teams/{team_a}/roster?week=1", cookies)
    slots_in_order = [p["lineup_slot"] for p in resp.json()["roster"]]
    assert slots_in_order == [
        "QB", "RB", "RB", "WR", "WR", "TE", "RB/WR/TE", "D/ST", "K", "BE", "IR",
    ]


async def test_matchup_detail_includes_both_rosters(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, team_b = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "matchup-rosters")

    async with pool.acquire() as conn:
        matchup_id = await conn.fetchval(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 1, $2, $3, 120.5, 100.0, FALSE)
            RETURNING id
            """,
            TEST_SEASON, team_a, team_b,
        )
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, pro_team, is_draftable, projected_avg_points) "
            "VALUES ('test-lg-star-runner', 'Star Runner', 'RB', 'KC', TRUE, 18.0)"
        )
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, pro_team, is_draftable, projected_avg_points) "
            "VALUES ('test-lg-backup-guy', 'Backup Guy', 'WR', 'SF', TRUE, 9.0)"
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, 'test-lg-star-runner', 'RB', 'draft')",
            TEST_SEASON, team_a,
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, 'test-lg-backup-guy', 'WR', 'draft')",
            TEST_SEASON, team_b,
        )
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, 1, 'test-lg-star-runner', '{}', 20.5)",
            TEST_SEASON,
        )
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, 1, 'test-lg-backup-guy', '{}', 10.0)",
            TEST_SEASON,
        )

    resp = await _get(f"/matchups/{matchup_id}", cookies)
    assert resp.status_code == 200
    body = resp.json()
    assert body["home"]["team_name"] == "Team Alpha"
    assert body["away"]["team_name"] == "Team Beta"
    assert [p["player_name"] for p in body["home"]["roster"]] == ["Star Runner"]
    assert [p["player_name"] for p in body["away"]["roster"]] == ["Backup Guy"]


async def test_matchup_detail_roster_includes_espn_player_id_and_pro_team(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, team_b = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "matchup-espn-id")

    async with pool.acquire() as conn:
        matchup_id = await conn.fetchval(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 1, $2, $3, 120.5, 100.0, FALSE)
            RETURNING id
            """,
            TEST_SEASON, team_a, team_b,
        )
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, pro_team, is_draftable, projected_avg_points) "
            "VALUES ('test-lg-star-runner-2', 'Star Runner', 'RB', 'KC', TRUE, 18.0)"
        )
        # A player with no real-world team assigned yet — player_id (its
        # own stable sleeper id) is always populated from current_rosters,
        # but pro_team can still be NULL, same as any free agent row.
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, pro_team, is_draftable, projected_avg_points) "
            "VALUES ('test-lg-backup-guy-2', 'Backup Guy', 'WR', NULL, TRUE, 9.0)"
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, 'test-lg-star-runner-2', 'RB', 'draft')",
            TEST_SEASON, team_a,
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, 'test-lg-backup-guy-2', 'WR', 'draft')",
            TEST_SEASON, team_b,
        )

    resp = await _get(f"/matchups/{matchup_id}", cookies)
    body = resp.json()
    assert body["home"]["roster"][0]["player_id"] == "test-lg-star-runner-2"
    assert body["home"]["roster"][0]["pro_team"] == "KC"
    assert body["away"]["roster"][0]["player_id"] == "test-lg-backup-guy-2"
    assert body["away"]["roster"][0]["pro_team"] is None


async def test_matchup_detail_includes_win_probability_boom_bust_and_scoped_bench_crime(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, team_b = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "matchup-winprob")

    async with pool.acquire() as conn:
        # A third, unrelated team in the same week — its own bench
        # crime must never leak into team_a/team_b's matchup detail,
        # even though it's the same week and objectively "worse."
        owner_c = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            "test-league-owner-c", "Cara Lee",
        )
        team_c = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4) RETURNING id",
            TEST_SEASON, 103, owner_c, "Team Gamma",
        )

        matchup_id = await conn.fetchval(
            """
            INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
            VALUES ($1, 9, $2, $3, 120.0, 100.0, FALSE)
            RETURNING id
            """,
            TEST_SEASON, team_a, team_b,
        )
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, pro_team, is_draftable, projected_avg_points) "
            "VALUES ('test-lg-boom-guy', 'Boom Guy', 'RB', 'KC', TRUE, 15.0)"
        )
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, pro_team, is_draftable, projected_avg_points) "
            "VALUES ('test-lg-bust-guy', 'Bust Guy', 'WR', 'SF', TRUE, 15.0)"
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, 'test-lg-boom-guy', 'RB', 'draft')",
            TEST_SEASON, team_a,
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, 'test-lg-bust-guy', 'WR', 'draft')",
            TEST_SEASON, team_b,
        )
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, 9, 'test-lg-boom-guy', '{}', 35.0)",
            TEST_SEASON,
        )
        await conn.execute(
            "INSERT INTO player_week_stats (season, week, sleeper_player_id, raw_stats, fantasy_points) "
            "VALUES ($1, 9, 'test-lg-bust-guy', '{}', 2.0)",
            TEST_SEASON,
        )
        await conn.execute(
            """
            INSERT INTO bench_crimes (season, week, team_id, bench_player, started_player, position, points_diff, severity)
            VALUES ($1, 9, $2, 'Bench Star', 'Starter Guy', 'WR', 12.0, 'Low Misdemeanor')
            """,
            TEST_SEASON, team_a,
        )
        await conn.execute(
            """
            INSERT INTO bench_crimes (season, week, team_id, bench_player, started_player, position, points_diff, severity)
            VALUES ($1, 9, $2, 'Other Bench Star', 'Other Starter', 'RB', 40.0, 'Felony Bench Crime')
            """,
            TEST_SEASON, team_c,
        )

    resp = await _get(f"/matchups/{matchup_id}", cookies)
    assert resp.status_code == 200
    body = resp.json()

    # Win probability: real, non-zero scores → both sides get a value,
    # complementary (sums to exactly 100), home (the higher scorer)
    # favored.
    assert body["home"]["win_probability"] is not None
    assert body["away"]["win_probability"] is not None
    assert round(body["home"]["win_probability"] + body["away"]["win_probability"], 1) == 100.0
    assert body["home"]["win_probability"] > body["away"]["win_probability"]

    # Boom/bust classification (app/domain/boom_bust.py) is still only
    # computed against the legacy `rosters` table and hasn't been ported
    # to current_rosters yet (see queries/league.py's get_current_roster
    # docstring) — both flags always come back False here, a real, known
    # gap rather than silently fabricated data.
    assert body["home"]["roster"][0]["is_boom"] is False
    assert body["away"]["roster"][0]["is_bust"] is False

    # Bench crime scoped to just this matchup's two teams.
    assert body["home"]["bench_crime"]["bench_player"] == "Bench Star"
    assert body["away"]["bench_crime"] is None


async def test_matchup_detail_404_for_unknown_id(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _member_cookies(pool, "matchup-404")
    resp = await _get("/matchups/999999999", cookies)
    assert resp.status_code == 404


async def test_team_roster_endpoint(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    team_a, _ = await _seed_two_teams(pool)
    cookies = await _member_cookies(pool, "team-roster-endpoint")

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, pro_team, is_draftable, projected_avg_points) "
            "VALUES ('test-lg-team-roster-star', 'Star Runner', 'RB', 'KC', TRUE, 18.0)"
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, 'test-lg-team-roster-star', 'RB', 'draft')",
            TEST_SEASON, team_a,
        )

    # No league_state cached for TEST_SEASON, so get_roster_for_week
    # falls through to the live current_rosters read regardless of
    # which week is requested — same real-roster path every other
    # roster-reading endpoint in this file already exercises.
    resp = await _get(f"/teams/{team_a}/roster?week=3", cookies)
    assert resp.status_code == 200
    body = resp.json()
    assert body["team"]["team_name"] == "Team Alpha"
    assert body["week"] == 3
    assert [p["player_name"] for p in body["roster"]] == ["Star Runner"]
    assert body["roster"][0]["player_id"] == "test-lg-team-roster-star"
    assert body["roster"][0]["pro_team"] == "KC"


async def test_team_detail_404_for_unknown_id(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _member_cookies(pool, "team-404")
    resp = await _get("/teams/999999999", cookies)
    assert resp.status_code == 404
