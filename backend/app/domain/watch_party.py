"""
The Watch Party "fantasy digest" — the live, ambient ticker of close
league matchups pushed into a room over its WebSocket (see
app/watch_party/manager.py and app/routers/watch_party.py's own /ws
route). Built entirely from data app/domain/matchup_context.py already
assembles for the Matchup screen; no new external data source.
"""
from app.config import _require
from app.domain import matchup_context
from app.queries import league as league_queries

# Below this, a matchup isn't worth interrupting the video call for —
# keeps the digest to "the games actually worth sweating," not every
# matchup in the league regardless of how lopsided it is.
SWEAT_HIGHLIGHT_THRESHOLD = 65


def compute_sweat_index(matchup: dict) -> dict | None:
    """None before either team's game has started (win_probability is
    only computed post-kickoff — see matchup_context.py's own
    docstring on that field) since there's nothing to be tense about
    yet. Otherwise a 0-100 score built from how far the home team's
    win probability sits from a coin flip: 50/50 is the single most
    nerve-wracking place a matchup can be, and win_probability already
    factors in real remaining-scoring uncertainty (via each league's
    own score standard deviation — see app/domain/win_probability.py),
    which is a better tension signal than a raw "players left" count
    would be on its own."""
    home_win_probability = matchup["home"]["win_probability"]
    if home_win_probability is None:
        return None

    score = round(100 - abs(home_win_probability - 50) * 2)
    if score >= 85:
        label = "Down to the wire!"
    elif score >= SWEAT_HIGHLIGHT_THRESHOLD:
        label = "Sweating this one"
    elif score >= 40:
        label = "Getting interesting"
    else:
        label = None
    return {"score": score, "label": label}


def _side_digest(side: dict) -> dict:
    return {
        "team_name": side["team_name"],
        "owner_name": side["owner_name"],
        "score": side["score"],
    }


async def build_fantasy_digest(conn, league_id: int) -> dict | None:
    """None if this season has no cached current week yet (nothing
    synced) — the caller (the watch-party poll job) treats that the
    same as "nothing to broadcast right now", not an error."""
    season = int(_require("ACTIVE_SEASON"))
    week = await league_queries.get_cached_current_week(conn, season)
    if week is None:
        return None

    context = await matchup_context.build_week_matchup_context(conn, season, week, league_id)
    highlighted = []
    for m in context["matchups"]:
        sweat = compute_sweat_index(m)
        if sweat is None or sweat["score"] < SWEAT_HIGHLIGHT_THRESHOLD:
            continue
        highlighted.append(
            {
                "matchup_id": m["matchup_id"],
                "home": _side_digest(m["home"]),
                "away": _side_digest(m["away"]),
                "sweat": sweat,
            }
        )
    highlighted.sort(key=lambda m: m["sweat"]["score"], reverse=True)

    return {"type": "fantasy_digest", "season": season, "week": week, "matchups": highlighted}
