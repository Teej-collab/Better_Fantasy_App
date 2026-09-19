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
    """pro_team abbreviation -> {next_opponent, game_time, opponent_pro_team}
    for every real NFL team playing in the given week. Works identically
    for a D/ST roster entry as for an individual player — a D/ST's own
    pro_team already equals its team abbreviation.

    opponent_pro_team is the same team next_opponent already names, just
    as a bare abbreviation ("IND") instead of the "vs "/"@ "-prefixed
    display string — added so a caller can join it against something
    keyed by plain abbreviation (team_position_rankings.get_rankings)
    without having to re-parse next_opponent's display formatting back
    apart."""
    lookup: dict[str, dict] = {}
    for game in games:
        home, away = game.get("home_team"), game.get("away_team")
        if not home or not away:
            continue
        lookup[home] = {"next_opponent": f"vs {away}", "game_time": game.get("date"), "opponent_pro_team": away}
        lookup[away] = {"next_opponent": f"@ {home}", "game_time": game.get("date"), "opponent_pro_team": home}
    return lookup


def live_status_by_pro_team(games: list[dict]) -> dict[str, dict]:
    """pro_team abbreviation -> {on_offense, is_redzone} for every real
    NFL team currently playing an in-progress game. Takes the exact
    same scoreboard dict list schedule_lookup_by_pro_team above already
    reads (app/providers/nfl_scoreboard.py) — every real caller already
    has that list in hand for the schedule lookup, so this costs no
    extra fetch.

    2026-09-13 fix, real report: this used to read app.gamecast.
    service's own cache (all_cached_states()/LiveGame) instead, which
    only ever tracks a game someone currently has THAT SPECIFIC game's
    Gamecast screen open for — a deliberate cost-saving gate (see
    scheduler.py's own docstring on gamecast_manager.live_game_ids()),
    exactly right for Gamecast's own detailed drive-by-drive tracking,
    but it meant this function silently returned nothing for any live
    game nobody happened to be watching in Gamecast at that moment.
    Confirmed live: CHI@CAR was genuinely in progress and simply never
    showed up here. The public scoreboard poll runs continuously
    regardless of who's looking at what, and already carries a real
    possession/red-zone signal (ESPN's own situation.possession/
    situation.isRedZone, parsed in nfl_scoreboard.py) for every live
    game — reading that instead means this now actually works for
    every real live game, not just a watched one.

    Deliberately excludes halftime/scheduled/final games (state !=
    "in") — no one is "on offense" when play isn't live."""
    lookup: dict[str, dict] = {}
    for game in games:
        if game.get("state") != "in":
            continue
        possession = game.get("possession_team_abbr")
        is_redzone = bool(game.get("is_redzone"))
        for team in (game.get("home_team"), game.get("away_team")):
            if not team:
                continue
            lookup[team] = {
                "on_offense": possession == team,
                "is_redzone": bool(is_redzone and possession == team),
            }
    return lookup


def game_status_by_pro_team(games: list[dict]) -> dict[str, str]:
    """pro_team abbreviation -> "scheduled" | "in_progress" | "final"
    for every real NFL team in this week's scoreboard — the matchup
    screen's own per-player text/score color state (2026-09-19,
    reference: a real ESPN matchup screenshot showing a player's name
    go grey pre-kickoff, white while their game is live, then back to
    grey post-game with only their scored point total staying white).
    Reuses the same scoreboard fetch schedule_lookup_by_pro_team/
    live_status_by_pro_team above already read — ESPN's own
    status.type.state ("pre"/"in"/"post", parsed in
    app/providers/nfl_scoreboard.py) is exactly this three-way split
    already, just needs renaming into words a frontend caller doesn't
    have to know ESPN's own vocabulary to branch on."""
    mapping = {"pre": "scheduled", "in": "in_progress", "post": "final"}
    lookup: dict[str, str] = {}
    for game in games:
        status = mapping.get(game.get("state"))
        if status is None:
            continue
        for team in (game.get("home_team"), game.get("away_team")):
            if team:
                lookup[team] = status
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
