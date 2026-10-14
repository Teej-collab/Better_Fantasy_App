"""
Player headshot URLs (2026-10, "like ESPN has"). ESPN's own CDN when
the player has an espn_player_id crosswalk (sized down through ESPN's
image combiner, ~8KB instead of the ~270KB full PNG), Sleeper's CDN
otherwise — every player here has a sleeper_player_id. A D/ST gets its
team's logo: Sleeper's DEF ids are the team abbreviations, and all 32
match ESPN's logo paths lowercased (checked 2026-10, WSH included).
Just URLs, nothing fetched here; the apps fall back to the position
when an image doesn't load.
"""

ESPN_HEADSHOT = "https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/{id}.png&w=96&h=70&cb=1"
ESPN_TEAM_LOGO = "https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/{abbr}.png&w=96&h=96"
SLEEPER_HEADSHOT = "https://sleepercdn.com/content/nfl/players/thumb/{id}.jpg"


def headshot_url(sleeper_player_id: str, espn_player_id: int | None, position: str | None) -> str:
    if position == "DEF":
        return ESPN_TEAM_LOGO.format(abbr=sleeper_player_id.lower())
    if espn_player_id:
        return ESPN_HEADSHOT.format(id=espn_player_id)
    return SLEEPER_HEADSHOT.format(id=sleeper_player_id)
