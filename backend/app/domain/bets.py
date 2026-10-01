"""
Bet tracking — tracking only: nothing here places a bet or touches
money. Pure functions (no I/O) for grading a bet's legs against a
game's live box score and score, and for the bet as a whole; the
router (app/routers/bets.py) does the fetching and saving.

A leg is one of:
- player_prop: a stat (STAT_KEYS) over/under a line, or a yes/no prop
  like "anytime touchdown" (anytime_td, direction yes);
- moneyline / spread: a team, graded from the final score;
- total: over/under the game's combined points;
- other: anything the app can't grade (first TD scorer, a quarter's
  winner...) — stays open until the user marks it.

"Over" and "yes" legs can be won mid-game (the line's already beaten);
"under" and "no" legs can be lost mid-game. Everything else waits for
the final.
"""
from __future__ import annotations

import re
import unicodedata

# Bet-friendly stat keys → (label, how to read it off a stat line from
# app/providers/nfl_stats/espn_public.parse_prop_stats).
STAT_KEYS: dict[str, tuple[str, tuple[str, ...]]] = {
    "pass_yd": ("Passing yards", ("pass_yd",)),
    "pass_td": ("Passing TDs", ("pass_td",)),
    "pass_int": ("Interceptions thrown", ("pass_int",)),
    "pass_cmp": ("Completions", ("pass_cmp",)),
    "pass_att": ("Pass attempts", ("pass_att",)),
    "rush_yd": ("Rushing yards", ("rush_yd",)),
    "rush_att": ("Rush attempts", ("rush_att",)),
    "rec": ("Receptions", ("rec",)),
    "rec_yd": ("Receiving yards", ("rec_yd",)),
    "rush_rec_yd": ("Rush + rec yards", ("rush_yd", "rec_yd")),
    "pass_rush_yd": ("Pass + rush yards", ("pass_yd", "rush_yd")),
    "anytime_td": ("Touchdowns", ("rush_td", "rec_td", "ret_td")),
    "long_rush": ("Longest rush", ("long_rush",)),
    "long_rec": ("Longest reception", ("long_rec",)),
    "sacks": ("Sacks", ("sacks",)),
    "tackles": ("Tackles", ("tackles",)),
    "kick_pts": ("Kicking points", ("kick_pts",)),
    "fg_made": ("Field goals made", ("fg_made",)),
}
_MAX_STATS = {"long_rush", "long_rec"}

MARKETS = ("player_prop", "moneyline", "spread", "total", "other")
DIRECTIONS = ("over", "under", "yes", "no")
LEG_STATUSES = ("open", "won", "lost", "push", "void")


def stat_value(stat_key: str, stats: dict | None) -> float:
    """A player's current value for a bet stat; 0 before they've
    recorded anything (they're in the box score only once they have)."""
    if not stats or stat_key not in STAT_KEYS:
        return 0.0
    parts = STAT_KEYS[stat_key][1]
    if stat_key in _MAX_STATS:
        return float(stats.get(parts[0], 0))
    return float(sum(stats.get(p, 0) for p in parts))


def evaluate_leg(leg: dict, game: dict | None, player_stats: dict | None) -> dict:
    """The leg's live state: {"status", "current", "target"}.

    `leg`: market, stat_key, line, direction, team_abbr (and status, kept
    when it's already settled by hand). `game`: scoreline from
    espn_public (state "pre"|"in"|"post", home/away team and score), or
    None when the leg isn't tied to a game. `player_stats`: the player's
    prop stat line, or None."""
    manual = leg.get("status")
    if manual in ("void",):
        return {"status": manual, "current": None, "target": leg.get("line")}
    market = leg.get("market")
    line = _num(leg.get("line"))
    direction = leg.get("direction")
    state = (game or {}).get("state")
    final = state == "post"

    if market == "player_prop":
        if leg.get("stat_key") not in STAT_KEYS:
            return {"status": manual or "open", "current": None, "target": line}
        current = stat_value(leg["stat_key"], player_stats)
        if direction in ("yes", "no"):
            # A yes/no prop's line is how many it takes: 1 for "anytime
            # TD", 2 for "2+ TDs". "Over 1.5" reads the same way.
            needed = line if line is not None and line >= 1 else 1
            hit = current >= needed
            if direction == "yes":
                status = "won" if hit else ("lost" if final else "open")
            else:
                status = "lost" if hit else ("won" if final else "open")
            return {"status": status, "current": current, "target": needed}
        if line is None or direction not in ("over", "under"):
            return {"status": "open", "current": current, "target": line}
        return {"status": _over_under(current, line, direction, final), "current": current, "target": line}

    if market == "total":
        if game is None or line is None or direction not in ("over", "under"):
            return {"status": "open", "current": None, "target": line}
        current = float(game.get("home_score", 0) + game.get("away_score", 0))
        if state == "pre":
            return {"status": "open", "current": None, "target": line}
        return {"status": _over_under(current, line, direction, final), "current": current, "target": line}

    if market in ("moneyline", "spread"):
        team = leg.get("team_abbr")
        if game is None or team not in (game.get("home_team"), game.get("away_team")):
            return {"status": "open", "current": None, "target": line}
        mine, theirs = (
            (game.get("home_score", 0), game.get("away_score", 0))
            if team == game.get("home_team")
            else (game.get("away_score", 0), game.get("home_score", 0))
        )
        if state == "pre":
            return {"status": "open", "current": None, "target": line}
        margin = mine - theirs + (line if market == "spread" and line is not None else 0)
        if not final:
            return {"status": "open", "current": float(mine - theirs), "target": line}
        status = "won" if margin > 0 else "lost" if margin < 0 else "push"
        return {"status": status, "current": float(mine - theirs), "target": line}

    return {"status": manual if manual in LEG_STATUSES else "open", "current": None, "target": line}


def _over_under(current: float, line: float, direction: str, final: bool) -> str:
    if direction == "over":
        if current > line:
            return "won"
        if not final:
            return "open"
        return "push" if current == line else "lost"
    # under
    if current > line:
        return "lost"
    if not final:
        return "open"
    return "push" if current == line else "won"


def bet_status(leg_statuses: list[str]) -> str:
    """A slip's result from its legs: any loss loses it; otherwise it's
    open until every leg is settled. Pushed/void legs drop out of a
    parlay; a slip where every leg pushed is a push."""
    if not leg_statuses:
        return "open"
    if "lost" in leg_statuses:
        return "lost"
    if "open" in leg_statuses:
        return "open"
    if "won" in leg_statuses:
        return "won"
    return "push" if "push" in leg_statuses else "void"


def american_payout_cents(stake_cents: int | None, odds: int | None) -> int | None:
    """Total return (stake + winnings) for American odds."""
    if not stake_cents or not odds:
        return None
    profit = stake_cents * (odds / 100 if odds > 0 else 100 / abs(odds))
    return round(stake_cents + profit)


# ---- Reading a slip ----

_STAT_ALIASES = {
    "passing yards": "pass_yd", "pass yards": "pass_yd", "pass yds": "pass_yd",
    "passing touchdowns": "pass_td", "passing tds": "pass_td", "pass tds": "pass_td",
    "interceptions": "pass_int", "interceptions thrown": "pass_int",
    "completions": "pass_cmp", "pass completions": "pass_cmp",
    "pass attempts": "pass_att", "passing attempts": "pass_att",
    "rushing yards": "rush_yd", "rush yards": "rush_yd", "rush yds": "rush_yd",
    "rush attempts": "rush_att", "rushing attempts": "rush_att", "carries": "rush_att",
    "receptions": "rec", "catches": "rec",
    "receiving yards": "rec_yd", "rec yards": "rec_yd", "rec yds": "rec_yd",
    "rushing + receiving yards": "rush_rec_yd", "rush + rec yards": "rush_rec_yd", "rush + rec yds": "rush_rec_yd",
    "passing + rushing yards": "pass_rush_yd", "pass + rush yards": "pass_rush_yd",
    "anytime touchdown": "anytime_td", "anytime td": "anytime_td", "anytime touchdown scorer": "anytime_td",
    "touchdowns": "anytime_td", "to score a touchdown": "anytime_td",
    "longest rush": "long_rush", "longest reception": "long_rec",
    "sacks": "sacks", "tackles": "tackles", "tackles + assists": "tackles",
    "kicking points": "kick_pts", "field goals made": "fg_made",
}


def normalize_stat_key(raw: str | None) -> str | None:
    if not raw:
        return None
    text = raw.strip().lower()
    if text in STAT_KEYS:
        return text
    text = re.sub(r"\s+", " ", text.replace("&", "+").replace(" and ", " + "))
    return _STAT_ALIASES.get(text)


def normalize_leg(raw: dict) -> dict:
    """One leg from the slip reader (app/providers/bet_slip_reader.py) or
    the edit form, cleaned to what the bet_legs table accepts."""
    market = raw.get("market") if raw.get("market") in MARKETS else "other"
    direction = (raw.get("direction") or "").lower() or None
    if direction not in DIRECTIONS:
        direction = None
    stat_key = normalize_stat_key(raw.get("stat_key") or raw.get("stat"))
    if market == "player_prop" and stat_key is None:
        market = "other"
    if stat_key == "anytime_td" and direction in (None, "over"):
        direction = "yes"
    # A game total names no team; either side finds the game.
    team = (raw.get("team_abbr") or raw.get("opponent_abbr") or "").strip().upper() or None
    return {
        "description": str(raw.get("description") or "").strip()[:300] or "Leg",
        "market": market,
        "player_name": (str(raw.get("player_name")).strip() or None) if raw.get("player_name") else None,
        "team_abbr": team[:4] if team else None,
        "stat_key": stat_key if market == "player_prop" else None,
        "line": _num(raw.get("line")),
        "direction": direction,
        "odds_american": _int(raw.get("odds_american")),
    }


def name_key(name: str | None) -> str:
    """Comparable form of a player's name: no accents, punctuation or
    suffixes ("Kenneth Walker III" == "kenneth walker")."""
    if not name:
        return ""
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    text = re.sub(r"[^a-z ]", "", text.replace("-", " "))
    words = [w for w in text.split() if w not in {"jr", "sr", "ii", "iii", "iv", "v"}]
    return " ".join(words)


def _num(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(str(value).replace("+", "")))
    except (TypeError, ValueError):
        return None
