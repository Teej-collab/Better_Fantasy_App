"""Bringing a league in from Sleeper (app/providers/sleeper/league.py,
the /league/sleeper-connection routes)."""
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.providers.sleeper import league as sleeper_league
from tests.conftest import TEST_SEASON

LEAGUE_ID = "998877665544332211"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _fake_sleeper(monkeypatch, season=TEST_SEASON):
    data = {
        f"/league/{LEAGUE_ID}": {
            "league_id": LEAGUE_ID, "name": "Test Sleeper League", "season": str(season), "sport": "nfl",
            "status": "in_season", "settings": {"playoff_week_start": 15},
            "roster_positions": ["QB", "RB", "FLEX", "DEF", "BN"],
        },
        f"/league/{LEAGUE_ID}/users": [
            {"user_id": "u-test-1", "display_name": "sleepy1", "metadata": {"team_name": "Nap Time"}},
            {"user_id": "u-test-2", "display_name": "sleepy2", "metadata": {}},
        ],
        f"/league/{LEAGUE_ID}/rosters": [
            {"roster_id": 1, "owner_id": "u-test-1"},
            {"roster_id": 2, "owner_id": "u-test-2"},
        ],
        "/state/nfl": {"week": 1},
        f"/league/{LEAGUE_ID}/matchups/1": [
            {"roster_id": 1, "matchup_id": 1, "points": 101.5, "starters": ["test-sl-qb", "test-sl-rb", "0", "WAS"],
             "players": ["test-sl-qb", "test-sl-rb", "WAS", "test-sl-bench"],
             "players_points": {"test-sl-qb": 20.2, "test-sl-rb": 11.3, "WAS": 7.0, "test-sl-bench": 3.0}},
            {"roster_id": 2, "matchup_id": 1, "points": 88.25, "starters": [], "players": [], "players_points": {}},
        ],
    }

    async def fake_get(path):
        return data.get(path)

    monkeypatch.setattr(sleeper_league, "_get", fake_get)


async def _seed_players(pool):
    async with pool.acquire() as conn:
        for pid, name, pos in (("test-sl-qb", "Sleeper QB", "QB"), ("test-sl-rb", "Sleeper RB", "RB"), ("test-sl-bench", "Sleeper WR", "WR")):
            await conn.execute(
                "INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable) "
                "VALUES ($1, $2, $3, $4, 'KC', 'Active', TRUE) ON CONFLICT DO NOTHING",
                pid, name, pos, [pos],
            )


def test_parse_league_id_takes_a_link_or_the_number():
    assert sleeper_league.parse_league_id(f"https://sleeper.com/leagues/{LEAGUE_ID}/matchup") == LEAGUE_ID
    assert sleeper_league.parse_league_id(LEAGUE_ID) == LEAGUE_ID
    assert sleeper_league.parse_league_id("my league") is None


async def test_connecting_a_sleeper_league_brings_in_teams_scores_and_lineups(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    _fake_sleeper(monkeypatch)
    await _seed_players(pool)
    async with _client() as client:
        await client.post("/auth/signup", json={"email": "test-sleeper-connect@example.com", "password": "correct-horse", "display_name": "Sleeper Commish"})
        await client.post("/leagues", json={"name": "Test League Sleeper"})
        resp = await client.post("/league/sleeper-connection", json={"league": f"https://sleeper.com/leagues/{LEAGUE_ID}"})
        status = await client.get("/league/sleeper-connection")
        espn = await client.post("/league/espn-connection", json={"league_url": "12345"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["league_name"] == "Test Sleeper League"
    assert status.json()["connected"] is True
    assert status.json()["last_sync_error"] is None
    assert espn.status_code in (400, 409)  # one source per league

    async with pool.acquire() as conn:
        league_id = await conn.fetchval("SELECT id FROM leagues WHERE name = 'Test League Sleeper'")
        teams = {r["espn_team_id"]: r["team_name"] for r in await conn.fetch(
            "SELECT espn_team_id, team_name FROM teams_by_season WHERE league_id = $1 AND season = $2", league_id, TEST_SEASON
        )}
        matchup = await conn.fetchrow("SELECT home_score, away_score FROM matchups WHERE league_id = $1 AND week = 1", league_id)
        lineup = {r["player_name"]: (r["lineup_slot"], float(r["points_scored"])) for r in await conn.fetch(
            "SELECT player_name, lineup_slot, points_scored FROM rosters WHERE league_id = $1 AND week = 1", league_id
        )}
    assert teams == {1: "Nap Time", 2: "Team sleepy2"}
    assert (float(matchup["home_score"]), float(matchup["away_score"])) == (101.5, 88.25)
    assert lineup["Sleeper QB"] == ("QB", 20.2)
    assert lineup["Sleeper RB"] == ("RB", 11.3)
    assert lineup["Sleeper WR"] == ("BE", 3.0)


async def test_last_seasons_sleeper_league_is_turned_away(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    _fake_sleeper(monkeypatch, season=TEST_SEASON - 1)
    async with _client() as client:
        await client.post("/auth/signup", json={"email": "test-sleeper-old@example.com", "password": "correct-horse", "display_name": "Old"})
        await client.post("/leagues", json={"name": "Test League Sleeper Old"})
        resp = await client.post("/league/sleeper-connection", json={"league": LEAGUE_ID})
    assert resp.status_code == 400
    assert str(TEST_SEASON) in resp.json()["detail"]


async def test_import_preview_shows_the_league_without_saving_it(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    _fake_sleeper(monkeypatch)
    async with _client() as client:
        await client.post("/auth/signup", json={"email": "test-sleeper-preview@example.com", "password": "correct-horse", "display_name": "Preview"})
        resp = await client.post("/leagues/import-preview", json={"platform": "sleeper", "league": f"https://sleeper.com/leagues/{LEAGUE_ID}"})
        bad = await client.post("/leagues/import-preview", json={"platform": "sleeper", "league": "nope"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "Test Sleeper League"
    assert body["team_count"] == 2
    assert body["teams"][0] == {"team_name": "Nap Time", "owner_name": "sleepy1"}
    assert bad.status_code == 400
    async with pool.acquire() as conn:
        assert await conn.fetchval("SELECT count(*) FROM league_sleeper_connections WHERE sleeper_league_id = $1 AND league_id NOT IN (SELECT id FROM leagues WHERE name LIKE 'Test League Sleeper%')", LEAGUE_ID) == 0


async def test_sleeper_leagues_by_username(pool, monkeypatch):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    data = {
        "/user/sleepyfan": {"user_id": "u-99", "username": "sleepyfan"},
        f"/user/u-99/leagues/nfl/{TEST_SEASON}": [{"league_id": LEAGUE_ID, "name": "Test Sleeper League", "total_rosters": 12, "status": "in_season"}],
    }

    async def fake_get(path):
        return data.get(path)

    monkeypatch.setattr(sleeper_league, "_get", fake_get)
    async with _client() as client:
        await client.post("/auth/signup", json={"email": "test-sleeper-user@example.com", "password": "correct-horse", "display_name": "U"})
        ok = await client.get("/leagues/sleeper-leagues", params={"username": "@sleepyfan"})
        missing = await client.get("/leagues/sleeper-leagues", params={"username": "nobody"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["leagues"] == [{"league_id": LEAGUE_ID, "name": "Test Sleeper League", "teams": 12, "status": "in_season"}]
    assert missing.status_code == 404


async def test_a_league_already_on_the_weekend_is_offered_to_join_not_copied(pool, monkeypatch):
    """2026-10-28: one copy per outside league. A second person bringing
    the same Sleeper league in sees it's already here (and can ask to
    join); connecting it to a second league is refused."""
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    _fake_sleeper(monkeypatch)
    await _seed_players(pool)
    pushes = []

    async def fake_send(conn, owner_id, payload, now=None):
        pushes.append((owner_id, payload["title"]))
        return 1

    monkeypatch.setattr("app.notifications.dispatcher.send_to_owner", fake_send)
    async with _client() as first:
        await first.post("/auth/signup", json={"email": "test-sleeper-first@example.com", "password": "correct-horse", "display_name": "First Commish"})
        await first.post("/leagues", json={"name": "Test League Sleeper First"})
        assert (await first.post("/league/sleeper-connection", json={"league": LEAGUE_ID})).status_code == 200
        mine = (await first.post("/leagues/import-preview", json={"platform": "sleeper", "league": LEAGUE_ID})).json()
    assert mine["existing"]["you_are_in_it"] is True

    async with _client() as second:
        await second.post("/auth/signup", json={"email": "test-sleeper-second@example.com", "password": "correct-horse", "display_name": "Second Person"})
        preview = (await second.post("/leagues/import-preview", json={"platform": "sleeper", "league": LEAGUE_ID})).json()
        asked = await second.post("/leagues/request-join", json={"platform": "sleeper", "external_id": LEAGUE_ID})
        await second.post("/leagues", json={"name": "Test League Sleeper Copy"})
        copy = await second.post("/league/sleeper-connection", json={"league": LEAGUE_ID})
    assert preview["existing"] == {"name": "Test League Sleeper First", "commissioner": "First Commish", "you_are_in_it": False}
    assert "invite_code" not in str(preview)
    assert asked.status_code == 200 and len(pushes) == 1
    assert copy.status_code == 409
    assert "already on The Weekend" in copy.json()["detail"]
