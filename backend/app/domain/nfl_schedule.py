"""
Cross-references a week's real NFL scoreboard (app/providers/
nfl_scoreboard.py) by pro_team abbreviation — the same public, keyless
endpoint the homepage ticker/game-day detection already use. Shared by
app/routers/me.py (My Team's own next_opponent/game_time) and
app/domain/matchup_context.py (the matchup screen's roster rows) so
both read a player's next real game the exact same way, rather than
two copies of this join drifting apart.
"""
from datetime import datetime, timezone


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


def locked_pro_teams(games: list[dict], now: datetime | None = None) -> frozenset[str]:
    """Every real NFL team (pro_team abbreviation) whose game for this
    week has already kicked off — the server-side half of the
    per-player lineup lock (app/domain/lineup_engine.py's move_player/
    swap_players): once a player's own game starts, their lineup slot
    is frozen for the week. This is the competitive audit's confirmed
    gap — a manager could start or bench a player after their game
    ended, with zero backend enforcement, until this landed. Per-player
    (via pro_team, since a whole real NFL team kicks off together),
    matching Sleeper/Yahoo's own per-player lock rather than ESPN's
    single whole-roster lock."""
    now = now or datetime.now(timezone.utc)
    locked: set[str] = set()
    for game in games:
        raw_date = game.get("date")
        if not raw_date:
            continue
        try:
            kickoff = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
        except ValueError:
            continue
        if kickoff > now:
            continue
        for team in (game.get("home_team"), game.get("away_team")):
            if team:
                locked.add(team)
    return frozenset(locked)
