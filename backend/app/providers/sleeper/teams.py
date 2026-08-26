"""
Static team-abbreviation -> full name lookup, needed only because
Sleeper's D/ST "player" entries are keyed by team abbreviation (e.g.
"SF") with first_name/last_name/full_name usually blank — every other
player object has a real name straight from Sleeper's data.

Abbreviations here are ESPN's convention (matching frontend/src/lib/
nfl-teams.ts, the app-wide standard already established before this
pivot), not Sleeper's raw one — ingest.py's _normalize_team_abbr
normalizes Sleeper's "team" field (and a DEF row's own id) to this
convention before this lookup ever runs. Confirmed via a real
ingestion run that Sleeper and ESPN disagree on exactly one
abbreviation: Washington ("WAS" in Sleeper's data, "WSH" here/in ESPN's
own convention) — Jacksonville matches ("JAX") on both.
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
    "WSH": "Washington Commanders",
}


def team_full_name(abbr: str) -> str:
    return TEAM_NAMES.get(abbr, abbr)
