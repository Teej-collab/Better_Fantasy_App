"""Gamecast's ESPN-style box score (app/gamecast/boxscore.py)."""
from app.gamecast.boxscore import parse_box_score


def _summary():
    def team(abbr, team_id, home_away, name, espn_id):
        return {
            "team": {"id": team_id, "abbreviation": abbr, "shortDisplayName": abbr.title(), "logo": f"https://x/{abbr}.png"},
            "homeAway": home_away,
            "statistics": [
                {"name": "receiving", "labels": ["REC", "YDS", "TD"], "athletes": [], "totals": ["0", "0", "0"]},
                {
                    "name": "passing",
                    "labels": ["C/ATT", "YDS", "TD", "INT"],
                    "athletes": [{"athlete": {"id": str(espn_id), "displayName": name, "lastName": name.split()[-1]}, "stats": ["6/15", "55", "0", "0"]}],
                    "totals": ["6/15", "55", "0", "0"],
                },
                {"name": "somethingNew", "labels": ["X"], "athletes": [{"athlete": {"id": "1"}, "stats": ["1"]}], "totals": ["1"]},
            ],
        }

    return {
        "header": {"competitions": [{"status": {"type": {"completed": False}}}]},
        "boxscore": {"players": [team("DAL", "6", "home", "Dak Prescott", 2577417), team("TB", "27", "away", "Jalon Daniels", 999)]},
    }


def test_box_score_lists_away_first_with_positions_and_our_player_ids():
    result = parse_box_score(_summary(), {2577417: ("4881", "QB")})
    assert result["final"] is False
    assert [t["abbr"] for t in result["teams"]] == ["TB", "DAL"]
    dal = result["teams"][1]
    # Empty categories and ones we don't know are left out.
    assert [c["key"] for c in dal["categories"]] == ["passing"]
    passing = dal["categories"][0]
    assert passing["title"] == "Passing"
    assert passing["labels"] == ["C/ATT", "YDS", "TD", "INT"]
    assert passing["athletes"][0] == {
        "espn_id": 2577417,
        "player_id": "4881",
        "name": "Dak Prescott",
        "short_name": "Prescott",
        "position": "QB",
        "stats": ["6/15", "55", "0", "0"],
    }
    assert passing["totals"] == ["6/15", "55", "0", "0"]


def test_box_score_player_without_a_crosswalk_still_shows():
    tb = parse_box_score(_summary(), {})["teams"][0]
    assert tb["categories"][0]["athletes"][0]["player_id"] is None
    assert tb["categories"][0]["athletes"][0]["position"] is None
