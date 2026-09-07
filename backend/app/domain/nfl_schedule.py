"""
Cross-references a week's real NFL scoreboard (app/providers/
nfl_scoreboard.py) by pro_team abbreviation — the same public, keyless
endpoint the homepage ticker/game-day detection already use. Shared by
app/routers/me.py (My Team's own next_opponent/game_time) and
app/domain/matchup_context.py (the matchup screen's roster rows) so
both read a player's next real game the exact same way, rather than
two copies of this join drifting apart.
"""


def schedule_lookup_by_pro_team(games: list[dict]) -> dict[str, dict]:
    """pro_team abbreviation -> {next_opponent, game_time} for every
    real NFL team playing in the given week. Works identically for a
    D/ST roster entry as for an individual player — a D/ST's own
    pro_team already equals its team abbreviation."""
    lookup: dict[str, dict] = {}
    for game in games:
        home, away = game.get("home_team"), game.get("away_team")
        if not home or not away:
            continue
        lookup[home] = {"next_opponent": f"vs {away}", "game_time": game.get("date")}
        lookup[away] = {"next_opponent": f"@ {home}", "game_time": game.get("date")}
    return lookup
