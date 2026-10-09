"""ESPN's athlete game log → our game log (app/providers/espn/player_game_log.py)."""
from app.providers.espn.player_game_log import parse_game_log


def _data():
    return {
        "categories": [{"name": "rushing", "displayName": "Rushing", "count": 2}, {"name": "receiving", "displayName": "Receiving", "count": 2}],
        "labels": ["CAR", "YDS", "REC", "YDS\t"],
        "events": {
            "1": {"week": 1, "atVs": "vs", "opponent": {"abbreviation": "NO"}, "gameResult": "W", "score": "31-30 OT"},
            "2": {"week": 2, "atVs": "@", "opponent": {"abbreviation": "BUF"}, "gameResult": "L", "score": "20-17"},
        },
        "seasonTypes": [
            {"displayName": "2026 Postseason", "categories": [{"events": [{"eventId": "9", "stats": ["1", "1", "1", "1"]}]}]},
            {"displayName": "2026 Regular Season", "categories": [{"events": [
                {"eventId": "2", "stats": ["16", "52", "3", "21"]},
                {"eventId": "1", "stats": ["29", "156", "5", "30"]},
            ]}]},
        ],
    }


def test_splits_columns_by_category_and_orders_games_by_week():
    log = parse_game_log(_data())
    assert log["categories"] == [
        {"key": "rushing", "title": "Rushing", "labels": ["CAR", "YDS"]},
        {"key": "receiving", "title": "Receiving", "labels": ["REC", "YDS"]},
    ]
    assert [g["week"] for g in log["games"]] == [1, 2]
    assert log["games"][0] == {"week": 1, "opponent": "NO", "result": "W 31-30 OT", "stats": {"rushing": ["29", "156"], "receiving": ["5", "30"]}}
    assert log["games"][1]["opponent"] == "@BUF"


def test_nothing_to_show():
    assert parse_game_log({}) is None
    assert parse_game_log({**_data(), "seasonTypes": []}) is None
