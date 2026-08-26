"""
Static team-abbreviation -> full name lookup, needed only because
Sleeper's D/ST "player" entries are keyed by team abbreviation (e.g.
"SF") with first_name/last_name/full_name usually blank — every other
player object has a real name straight from Sleeper's data.

Abbreviations here are Sleeper's own convention. Phase E of the project
plan flags that Sleeper/ESPN have historically disagreed on a couple of
abbreviations (Washington, Jacksonville) — that reconciliation happens
where gamecast's live provider data meets this table, not here.
"""
TEAM_NAMES: dict[str, str] = {
    "ARI": "Arizona Cardinals",
    "ATL": "Atlanta Falcons",
    "BAL": "Baltimore Ravens",
    "BUF": "Buffalo Bills",
    "CAR": "Carolina Panthers",
    "CHI": "Chicago Bears",
    "CIN": "Cincinnati Bengals",
    "CLE": "Cleveland Browns",
    "DAL": "Dallas Cowboys",
    "DEN": "Denver Broncos",
    "DET": "Detroit Lions",
    "GB": "Green Bay Packers",
    "HOU": "Houston Texans",
    "IND": "Indianapolis Colts",
    "JAX": "Jacksonville Jaguars",
    "KC": "Kansas City Chiefs",
    "LAC": "Los Angeles Chargers",
    "LAR": "Los Angeles Rams",
    "LV": "Las Vegas Raiders",
    "MIA": "Miami Dolphins",
    "MIN": "Minnesota Vikings",
    "NE": "New England Patriots",
    "NO": "New Orleans Saints",
    "NYG": "New York Giants",
    "NYJ": "New York Jets",
    "PHI": "Philadelphia Eagles",
    "PIT": "Pittsburgh Steelers",
    "SEA": "Seattle Seahawks",
    "SF": "San Francisco 49ers",
    "TB": "Tampa Bay Buccaneers",
    "TEN": "Tennessee Titans",
    "WAS": "Washington Commanders",
}


def team_full_name(abbr: str) -> str:
    return TEAM_NAMES.get(abbr, abbr)
