"""The projection engine (app/domain/projections/)."""
import json

from app.domain.projections import accuracy, engine, stat_lines
from app.domain.projections.distribution import simulate
from app.domain.projections.model import ProjectionModel
from app.domain.projections.scoring import expected_points
from app.providers import projection_feeds
from app.queries import league as league_queries
from tests.conftest import TEST_SEASON

PPR = {"pass_yd": 0.04, "pass_td": 4, "pass_int": -2, "rush_yd": 0.1, "rush_td": 6, "rec": 1, "rec_yd": 0.1,
       "rec_td": 6, "fum_lost": -2, "two_pt_pass": 2, "two_pt_rush": 2, "two_pt_rec": 2}

# ESPN's real week-9 2026 projection for Patrick Mahomes (leaguedefaults,
# PPR); ESPN's own appliedTotal for it was 18.17.
MAHOMES_ESPN = {"0": 33.44, "1": 22.06, "2": 11.37, "3": 253.96, "4": 1.72, "15": 0.22, "16": 0.14, "17": 0.24,
                "18": 0.03, "19": 0.08, "20": 0.66, "23": 3.48, "24": 16.7, "25": 0.16, "26": 0.01, "35": 0.01,
                "68": 0.36, "72": 0.17}


def test_espn_stat_ids_score_back_to_espns_own_total():
    line = stat_lines.from_espn(MAHOMES_ESPN, "QB")
    assert abs(expected_points(line, {}, "QB", PPR) - 18.17) < 0.05


def test_threshold_bonuses_are_priced_by_their_odds():
    line = {"rush_att": 18, "rush_yd": 85, "rush_td": 0.6, "_tgt": 3, "rec": 2.4, "rec_yd": 18}
    probs = simulate(line, "RB", "seed")["probs"]
    assert 0.2 < probs["bonus_rush_100"] < 0.45
    plain = expected_points(line, probs, "RB", PPR)
    with_bonus = expected_points(line, probs, "RB", {**PPR, "bonus_rush_100": 3})
    assert abs((with_bonus - plain) - 3 * probs["bonus_rush_100"]) < 1e-9


def test_te_premium_and_dst_tiers_follow_the_league():
    te = {"_tgt": 7, "rec": 5, "rec_yd": 55, "rec_td": 0.4}
    assert expected_points(te, {}, "TE", {**PPR, "te_rec": 0.5}) - expected_points(te, {}, "TE", PPR) == 2.5
    dst = {"_pts_allow": 14.0, "_yds_allow": 300.0, "def_sack": 3}
    probs = simulate(dst, "DEF", "dst")["probs"]
    assert abs(sum(v for k, v in probs.items() if k.startswith("pts_allow_")) - 1) < 1e-6
    shutout_league = {"pts_allow_0": 10, "def_sack": 1}
    assert expected_points(dst, probs, "DEF", shutout_league) == 3 + 10 * probs.get("pts_allow_0", 0)


def _history(weeks=4):
    rows = []
    for w in range(1, weeks + 1):
        for pid, pos, stats in (
            ("qb1", "QB", {"pass_att": 34, "pass_cmp": 22, "pass_yd": 250, "pass_td": 2, "rush_att": 3, "rush_yd": 12, "off_snp": 60}),
            ("rb1", "RB", {"rush_att": 18, "rush_yd": 80, "rush_td": 1, "rec_tgt": 3, "rec": 2, "rec_yd": 15, "off_snp": 45}),
            ("rb2", "RB", {"rush_att": 6, "rush_yd": 25, "rec_tgt": 1, "rec": 1, "rec_yd": 5, "off_snp": 15}),
            ("wr1", "WR", {"rec_tgt": 10, "rec": 7, "rec_yd": 90, "rec_td": 0.5, "off_snp": 58}),
        ):
            rows.append({"season": TEST_SEASON, "week": w, "sleeper_player_id": pid, "position": pos,
                         "team": "AAA", "opponent": "BBB", "stats": stats})
        rows.append({"season": TEST_SEASON, "week": w, "sleeper_player_id": "BBB", "position": "DEF", "team": "BBB",
                     "opponent": "AAA", "stats": {"pts_allow": 24, "yds_allow": 340, "sack": 2, "int": 1,
                                                   "fan_pts_allow_rb": 22, "fan_pts_allow_wr": 30}})
    return rows


def test_model_hands_an_out_starters_carries_to_the_backup():
    universe = {
        "qb1": {"position": "QB", "team": "AAA", "injury_status": None},
        "rb1": {"position": "RB", "team": "AAA", "injury_status": None},
        "rb2": {"position": "RB", "team": "AAA", "injury_status": None},
        "wr1": {"position": "WR", "team": "AAA", "injury_status": None},
    }
    lines = {"AAA": {"opponent": "BBB", "spread": -3.0, "total": 46.0, "implied_points": 24.5}}
    model = ProjectionModel(_history(), TEST_SEASON, 5)
    healthy = model.project(universe, lines)
    assert healthy["rb1"]["rush_att"] > 2.5 * healthy["rb2"]["rush_att"]
    assert healthy["wr1"]["rec"] > 5 and healthy["qb1"]["pass_yd"] > 180

    universe["rb1"]["injury_status"] = "Out"
    hurt = model.project(universe, lines)
    assert "rb1" not in hurt
    assert hurt["rb2"]["rush_att"] > healthy["rb2"]["rush_att"] * 1.3


async def test_engine_projects_each_league_in_its_own_scoring(pool, monkeypatch):
    week = 5
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable) "
            "VALUES ('test-proj-wr', 'Projection Wideout', 'WR', '{WR}', 'AAA', 'Active', TRUE) ON CONFLICT DO NOTHING"
        )
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name) VALUES ('test-proj@example.com', 'x', 'P') RETURNING id"
        )
        leagues = []
        for code, rec in (("PROJPPR1", 1.0), ("PROJSTD1", 0.0)):
            league_id = await conn.fetchval(
                "INSERT INTO leagues (name, created_by_user_id, invite_code) VALUES ($1, $2, $1) RETURNING id",
                f"Test League {code}", user_id,
            )
            for cat, value in {**PPR, "rec": rec}.items():
                await conn.execute(
                    "INSERT INTO league_scoring_rules (league_id, season, stat_category, points_per_unit) VALUES ($1, $2, $3, $4)",
                    league_id, TEST_SEASON, cat, value,
                )
            leagues.append(league_id)

    sleeper_line = {"rec_tgt": 8, "rec": 6, "rec_yd": 70, "rec_td": 0.5}

    async def fake_sleeper_week(season, wk, kind):
        if kind == "projections":
            return [{"sleeper_player_id": "test-proj-wr", "position": "WR", "team": "AAA", "opponent": "BBB", "stats": sleeper_line}]
        return []

    async def fake_espn(season, wk, limit=1200):
        return [{"espn_id": None, "name": "Projection Wideout", "position": "WR", "team": "AAA",
                 "stats": {"58": 9, "53": 6.5, "42": 75, "43": 0.6}}]

    async def fake_vegas(season, wk):
        return [{"team": "AAA", "opponent": "BBB", "is_home": True, "spread": -3.0, "total": 46.0, "implied_points": 24.5}]

    async def fake_scoreboard(wk, season):
        return []

    monkeypatch.setattr(projection_feeds, "sleeper_week", fake_sleeper_week)
    monkeypatch.setattr(projection_feeds, "espn_week_projections", fake_espn)
    monkeypatch.setattr(projection_feeds, "vegas_lines", fake_vegas)
    monkeypatch.setattr(engine, "get_week_scoreboard", fake_scoreboard)

    async with pool.acquire() as conn:
        assert await engine.sync_game_lines(conn, TEST_SEASON, week) == 1
        built = await engine.build_lines(conn, TEST_SEASON, week)
        assert built["sleeper"] == 1 and built["espn"] == 1
        await engine.score_leagues(conn, TEST_SEASON, week, leagues)
        rows = {
            r["league_id"]: r
            for r in await conn.fetch(
                "SELECT * FROM league_player_projections WHERE season = $1 AND sleeper_player_id = 'test-proj-wr'", TEST_SEASON
            )
        }
    ppr, std = rows[leagues[0]], rows[leagues[1]]
    by_source = json.loads(ppr["by_source"])
    # Sleeper's line in PPR: 6 + 7 + 3 = 16; ESPN's: 6.5 + 7.5 + 3.6 = 17.6.
    assert abs(by_source["sleeper"] - 16.0) < 0.01 and abs(by_source["espn"] - 17.6) < 0.01
    # The blend: the model has its own (small, no-history) line too.
    assert set(by_source) == {"model", "sleeper", "espn"}
    assert abs(float(ppr["projected_points"]) - accuracy.blend(by_source, accuracy.DEFAULT_WEIGHTS)) < 0.01
    # Same players, standard scoring: no point per catch.
    std_source = json.loads(std["by_source"])
    assert abs(std_source["sleeper"] - 10.0) < 0.01 and abs(std_source["espn"] - 11.1) < 0.01
    assert float(ppr["floor_points"]) < float(ppr["projected_points"]) < float(ppr["ceiling_points"])

    # Rosters read the league's own number over the old global one.
    async with pool.acquire() as conn:
        owner = await conn.fetchval("INSERT INTO owners (espn_member_id, display_name) VALUES ('test-proj-owner', 'P') RETURNING owner_id")
        team = await conn.fetchval(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) VALUES ($1, 1, $2, 'T', $3) RETURNING id",
            TEST_SEASON, owner, leagues[1],
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, league_id) VALUES ($1, $2, 'test-proj-wr', 'WR', $3)",
            TEST_SEASON, team, leagues[1],
        )
        await conn.execute(
            "INSERT INTO player_weekly_projections (season, week, sleeper_player_id, projected_points) VALUES ($1, $2, 'test-proj-wr', 99)",
            TEST_SEASON, week,
        )
        roster = await league_queries.get_current_roster(conn, TEST_SEASON, team, week)
    assert abs(float(roster[0]["points_projected"]) - float(std["projected_points"])) < 0.01


def test_blend_weights_lean_on_the_most_accurate_source():
    weights = accuracy.blend({"model": 10.0, "sleeper": 20.0}, {"model": 0.25, "sleeper": 0.375, "espn": 0.375})
    assert abs(weights - (10 * 0.25 + 20 * 0.375) / 0.625) < 1e-9
