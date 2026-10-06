from app.domain.playoff_odds import decode_scenario, simulate
from app.domain.playoffs import bracket_spec


def _world(scores_by_team: dict[int, float], weeks_played: int = 3, weeks_left: int = 3):
    """Four teams, round-robin-ish: 1v2 and 3v4 every week. Each team
    scores its fixed number in played weeks."""
    teams = [{"team_id": t, "team_name": f"T{t}", "owner_id": t, "logo_url": None, "name": f"T{t}"} for t in (1, 2, 3, 4)]
    schedule = []
    gid = 1
    for week in range(1, weeks_played + weeks_left + 1):
        for h, a in ((1, 2), (3, 4)) if week % 2 else ((1, 3), (2, 4)):
            played = week <= weeks_played
            schedule.append({
                "id": gid, "week": week, "home_team_id": h, "away_team_id": a,
                "home_score": scores_by_team[h] if played else 0.0, "away_score": scores_by_team[a] if played else 0.0,
                "played": played,
            })
            gid += 1
    games = [{**g, "weeks": [20], "toilet_bowl": False, "team_a_id": None, "team_b_id": None, "winner_team_id": None} for g in bracket_spec(2, 4)]
    return {"status": "projected", "playoff_team_count": 2, "teams": teams, "schedule": schedule, "games": games}


def test_the_best_team_is_the_clear_favorite():
    world = _world({1: 160.0, 2: 100.0, 3: 110.0, 4: 90.0})
    result = simulate(world, decode_scenario(None), focus_team=1, sims=2000, seed=7)
    by_team = {t["team_id"]: t for t in result["teams"]}
    assert by_team[1]["playoff_pct"] > 95
    assert by_team[1]["title_pct"] > by_team[4]["title_pct"]
    assert by_team[1]["ppg"] == 160.0
    # Odds for every team add up to the number of playoff spots.
    assert round(sum(t["playoff_pct"] for t in result["teams"])) == 200


def test_picks_and_flips_change_the_world():
    world = _world({1: 120.0, 2: 119.0, 3: 121.0, 4: 118.0})
    base = simulate(world, decode_scenario(None), focus_team=4, sims=2000, seed=7)
    # Team 4 wins every game it has left (ids of its unplayed games).
    left = [g["id"] for g in world["schedule"] if not g["played"] and 4 in (g["home_team_id"], g["away_team_id"])]
    played = [g["id"] for g in world["schedule"] if g["played"] and 4 in (g["home_team_id"], g["away_team_id"])]
    raw = "f." + ",".join(map(str, played)) + "~p." + ",".join(f"{i}:4" for i in left)
    alt = simulate(world, decode_scenario(raw), focus_team=4, sims=2000, seed=7)
    pct = lambda r: next(t["playoff_pct"] for t in r["teams"] if t["team_id"] == 4)  # noqa: E731
    assert pct(alt) == 100.0 > pct(base)
    assert alt["focus"]["win_out_pct"] == 100.0


def test_decode_scenario_matches_the_clients_format():
    s = decode_scenario("f.12,15~p.33:4,34:7~x.SF1:4,C8:9~me.3")
    assert s["flips"] == {12, 15}
    assert s["picks"] == {33: 4, 34: 7}
    assert s["playoff"] == {"SF1": 4, "C8": 9}
