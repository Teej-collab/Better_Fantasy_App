"""Mirror mode and the switch to The Weekend (app/domain/league_mode.py,
league_switch.py, league_settings_import.py, providers/mirror_rosters.py)."""
from httpx import ASGITransport, AsyncClient

from app.domain import league_settings_import as imp
from app.domain import league_switch
from app.main import app
from app.providers.sleeper import league as sleeper_league
from tests.conftest import TEST_SEASON

LEAGUE_ID = "887766554433221100"
PLAYERS = (("test-mir-qb", "Mirror QB", "QB"), ("test-mir-rb", "Mirror RB", "RB"), ("test-mir-wr", "Mirror WR", "WR"),
           ("test-mir-rb2", "Mirror RB2", "RB"))


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def test_sleeper_scoring_translates_names_bands_and_notes():
    rules, notes = imp.translate_sleeper_scoring({
        "pass_yd": 0.04, "pass_td": 4, "rec": 0.5, "pass_2pt": 2, "xpm": 1,
        "fgm_0_19": 3, "fgm_20_29": 3, "fgm_30_39": 3, "fgm_50p": 5,
        "pts_allow_14_20": 1, "pts_allow_21_27": 0, "pts_allow_35p": -4, "sack": 1, "safe": 2,
        "bonus_fd_rb": 0.5,
    })
    assert rules["pass_yd"] == 0.04 and rules["rec"] == 0.5 and rules["two_pt_pass"] == 2
    assert rules["fg_made_0_39"] == 3 and rules["fg_made_50_plus"] == 5
    assert rules["pts_allow_14_17"] == 1 and rules["pts_allow_18_27"] == 0
    assert rules["pts_allow_35_45"] == rules["pts_allow_46_plus"] == -4
    assert rules["def_sack"] == 1 and rules["def_safety"] == 2
    assert any("bonus_fd_rb" in n for n in notes)
    assert any("18–20" in n for n in notes)


def test_espn_scoring_translates_per_n_yards_and_yardage_bonuses():
    rules, notes = imp.translate_espn_scoring([
        {"abbr": "PY25", "points": 1}, {"abbr": "PTD", "points": 6}, {"abbr": "REC", "points": 1},
        {"abbr": "P300", "points": 2}, {"abbr": "P400", "points": 5}, {"abbr": "FGM", "points": -1},
        {"abbr": "PA18", "points": 0}, {"abbr": "PA22", "points": 0}, {"abbr": "HALFSK", "points": 0.5},
    ])
    assert rules["pass_yd"] == 0.04 and rules["pass_td"] == 6 and rules["rec"] == 1
    assert rules["bonus_pass_300"] == 2 and rules["bonus_pass_400"] == 3  # 400+ is on top of 300+ here
    assert rules["fg_miss_0_29"] == rules["fg_miss_50_plus"] == -1
    assert any("HALFSK" in n for n in notes)


def _fake_sleeper(monkeypatch, starters=("test-mir-qb", "test-mir-rb", "test-mir-wr")):
    data = {
        f"/league/{LEAGUE_ID}": {
            "league_id": LEAGUE_ID, "name": "Mirror League", "season": str(TEST_SEASON), "sport": "nfl", "status": "in_season",
            "settings": {"playoff_week_start": 15, "playoff_teams": 4, "waiver_type": 2, "waiver_budget": 100},
            "roster_positions": ["QB", "RB", "FLEX", "BN"],
            "scoring_settings": {"pass_td": 6, "rec": 0.5, "rush_yd": 0.1},
        },
        f"/league/{LEAGUE_ID}/users": [{"user_id": "u-mir-1", "display_name": "mirror1", "metadata": {"team_name": "Mirrors"}},
                                       {"user_id": "u-mir-2", "display_name": "mirror2", "metadata": {}}],
        f"/league/{LEAGUE_ID}/rosters": [
            {"roster_id": 1, "owner_id": "u-mir-1", "players": ["test-mir-qb", "test-mir-rb", "test-mir-wr", "test-mir-rb2"],
             "starters": list(starters), "reserve": [], "settings": {"waiver_budget_used": 23}},
            {"roster_id": 2, "owner_id": "u-mir-2", "players": [], "starters": [], "settings": {"waiver_budget_used": 0}},
        ],
        "/state/nfl": {"week": 1},
        f"/league/{LEAGUE_ID}/matchups/1": [
            {"roster_id": 1, "matchup_id": 1, "points": 90.5, "starters": [], "players": [], "players_points": {}},
            {"roster_id": 2, "matchup_id": 1, "points": 80.0, "starters": [], "players": [], "players_points": {}},
        ],
    }

    async def fake_get(path):
        return data.get(path)

    monkeypatch.setattr(sleeper_league, "_get", fake_get)
    return data


async def _setup(pool, monkeypatch, suffix):
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    async with pool.acquire() as conn:
        for pid, name, pos in PLAYERS:
            await conn.execute(
                "INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable) "
                "VALUES ($1, $2, $3, $4, 'KC', 'Active', TRUE) ON CONFLICT DO NOTHING",
                pid, name, pos, [pos],
            )
    data = _fake_sleeper(monkeypatch)
    client = _client()
    await client.__aenter__()
    await client.post("/auth/signup", json={"email": f"test-mirror-{suffix}@example.com", "password": "correct-horse", "display_name": "Mirror"})
    await client.post("/leagues", json={"name": f"Test League Mirror {suffix}"})
    resp = await client.post("/league/sleeper-connection", json={"league": LEAGUE_ID})
    assert resp.status_code == 200, resp.text
    async with pool.acquire() as conn:
        league_id = await conn.fetchval("SELECT id FROM leagues WHERE name = $1", f"Test League Mirror {suffix}")
        owner = await conn.fetchval(
            "SELECT owner_id FROM teams_by_season WHERE league_id = $1 AND espn_team_id = 1", league_id
        )
    claimed = await client.post(f"/leagues/{league_id}/claim-owner", json={"owner_id": owner})
    assert claimed.status_code == 200, claimed.text
    client.cookies.update({"session": claimed.json()["token"]})
    return client, league_id, data


async def test_connecting_copies_rosters_and_rules_and_locks_moves(pool, monkeypatch):
    client, league_id, _ = await _setup(pool, monkeypatch, "lock")
    try:
        async with pool.acquire() as conn:
            roster = {r["sleeper_player_id"]: r["lineup_slot"] for r in await conn.fetch(
                "SELECT sleeper_player_id, lineup_slot FROM current_rosters WHERE league_id = $1", league_id
            )}
            rec = await conn.fetchval(
                "SELECT points_per_unit FROM league_scoring_rules WHERE league_id = $1 AND stat_category = 'rec'", league_id
            )
            slots = await conn.fetchval("SELECT roster_slots FROM draft_config WHERE league_id = $1", league_id)
        assert roster == {"test-mir-qb": "QB", "test-mir-rb": "RB", "test-mir-wr": "RB/WR/TE", "test-mir-rb2": "BE"}
        assert float(rec) == 0.5
        assert '"RB/WR/TE": 1' in slots or '"RB/WR/TE":1' in slots

        status = (await client.get("/league/switch")).json()
        assert status["mirrored"] is True and status["platform"] == "sleeper"
        assert status["claimed"] == 1 and status["teams"] == 2

        drop = await client.post("/me/team/lineup/drop", json={"sleeper_player_id": "test-mir-rb2"})
        assert drop.status_code == 409
        assert "runs on Sleeper" in drop.json()["detail"]
        block = await client.post("/trades/block", json={"sleeper_player_id": "test-mir-rb2"})
        assert block.status_code == 409
    finally:
        await client.__aexit__(None, None, None)


async def test_a_move_on_sleeper_shows_up_on_the_next_copy(pool, monkeypatch):
    client, league_id, data = await _setup(pool, monkeypatch, "follow")
    try:
        data[f"/league/{LEAGUE_ID}/rosters"][0]["players"] = ["test-mir-qb", "test-mir-rb2"]
        data[f"/league/{LEAGUE_ID}/rosters"][0]["starters"] = ["test-mir-qb", "test-mir-rb2", "0"]
        await league_switch.refresh(pool, league_id, TEST_SEASON)
        async with pool.acquire() as conn:
            roster = {r["sleeper_player_id"]: r["lineup_slot"] for r in await conn.fetch(
                "SELECT sleeper_player_id, lineup_slot FROM current_rosters WHERE league_id = $1", league_id
            )}
            # Sleeper's score still wins: the copied rosters don't make the app score it.
            score = await conn.fetchval("SELECT home_score FROM matchups WHERE league_id = $1 AND week = 1", league_id)
        assert roster == {"test-mir-qb": "QB", "test-mir-rb2": "RB"}
        assert float(score) == 90.5
    finally:
        await client.__aexit__(None, None, None)


async def test_switching_now_unlocks_moves_and_carries_faab(pool, monkeypatch):
    client, league_id, _ = await _setup(pool, monkeypatch, "now")

    async def not_started(week, year):
        return [{"state": "pre"}]

    monkeypatch.setattr(league_switch, "get_week_scoreboard", not_started)
    try:
        resp = await client.post("/league/switch")
        assert resp.status_code == 200, resp.text
        assert resp.json()["switched"] is True
        assert resp.json()["status"]["mirrored"] is False
        assert resp.json()["status"]["switched_from"] == "sleeper"
        async with pool.acquire() as conn:
            team_id = await conn.fetchval("SELECT id FROM teams_by_season WHERE league_id = $1 AND espn_team_id = 1", league_id)
            carried = await conn.fetchval("SELECT amount FROM faab_carryover WHERE league_id = $1 AND team_id = $2", league_id, team_id)
            waiver_type = await conn.fetchval("SELECT waiver_type FROM league_waiver_settings WHERE league_id = $1", league_id)
        assert carried == 23
        assert waiver_type == "faab"
        drop = await client.post("/me/team/lineup/drop", json={"sleeper_player_id": "test-mir-rb2"})
        assert drop.status_code != 409
    finally:
        await client.__aexit__(None, None, None)


async def test_switching_mid_week_waits_for_next_week(pool, monkeypatch):
    client, league_id, _ = await _setup(pool, monkeypatch, "later")

    async def started(week, year):
        return [{"state": "in"}]

    monkeypatch.setattr(league_switch, "get_week_scoreboard", started)
    try:
        resp = await client.post("/league/switch")
        assert resp.status_code == 200, resp.text
        assert resp.json()["switched"] is False
        effective = resp.json()["status"]["pending"]["effective_week"]
        assert effective == resp.json()["effective_week"]
        assert resp.json()["status"]["mirrored"] is True
        assert await league_switch.process_due(pool, TEST_SEASON, effective - 1) == []

        async def fresh(week, year):
            return [{"state": "pre"}]

        monkeypatch.setattr(league_switch, "get_week_scoreboard", fresh)
        assert await league_switch.process_due(pool, TEST_SEASON, effective) == [league_id]
        status = (await client.get("/league/switch")).json()
        assert status["mirrored"] is False
    finally:
        await client.__aexit__(None, None, None)
