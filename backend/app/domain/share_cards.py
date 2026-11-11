"""
What a shared card shows (2026-11-10, the share overhaul): one compact,
public-safe payload per kind, built live from the league's real data
so a shared live matchup keeps moving. Read by GET /share/{token}
(app/routers/share.py), which the web's card images and public share
page render (frontend/src/app/s/). Only what the card shows goes out:
first names, team names, scores, records and the week's headlines.

Kinds: matchup {matchup_id}, recap {season, week}, standings {season},
power {season, week}, awards {season, week}. A builder returns None
when there's nothing to show yet (an unreleased recap, a week still
being played), and the link answers 404 until there is.
"""
import re

from app.domain import narrative_engine, power_rankings, recap_release, weekly_awards
from app.domain.matchup_context import build_matchup_detail
from app.providers.nfl_scoreboard import get_week_scoreboard, is_week_final
from app.queries import chug as chug_queries
from app.queries import league as league_queries

KINDS = ("matchup", "recap", "standings", "power", "awards")
_BENCH = {"BE", "IR", "TAXI"}
_HEADSHOT = "https://sleepercdn.com/content/nfl/players/thumb/{}.jpg"


def first_name(owner_name: str | None, goes_by: str | None = None) -> str:
    if goes_by:
        return goes_by
    parts = (owner_name or "").split()
    return parts[0] if parts else ""


def stat_line(raw: dict | None, position: str | None) -> str | None:
    """"9 rec · 148 yds · 2 TD" from a player's week stats."""
    if not raw:
        return None
    n = lambda k: int(round(float(raw.get(k) or 0)))  # noqa: E731
    bits: list[str] = []
    if position == "QB" or n("pass_yd") >= 50:
        if n("pass_yd"):
            bits.append(f"{n('pass_yd')} pass yds")
        if n("pass_td"):
            bits.append(f"{n('pass_td')} TD")
        if n("pass_int"):
            bits.append(f"{n('pass_int')} INT")
    if n("rush_yd") or n("rush_td"):
        bits.append(f"{n('rush_att')} car · {n('rush_yd')} yds" if n("rush_att") else f"{n('rush_yd')} rush yds")
        if n("rush_td"):
            bits.append(f"{n('rush_td')} TD")
    if n("rec"):
        bits.append(f"{n('rec')} rec · {n('rec_yd')} yds")
        if n("rec_td"):
            bits.append(f"{n('rec_td')} TD")
    return " · ".join(bits[:4]) or None


def headline(text: str, limit: int = 170) -> str:
    """The recap's first sentence, for the card."""
    first = re.split(r"(?<=[.!?])\s+", text.strip(), maxsplit=1)[0]
    return first if len(first) <= limit else first[: limit - 1].rsplit(" ", 1)[0] + "…"


async def _goes_by(conn, league_id: int, season: int) -> dict[int, str]:
    rows = await conn.fetch(
        """
        SELECT t.id AS team_id, o.display_name, o.goes_by
        FROM teams_by_season t JOIN owners o ON o.owner_id = t.owner_id
        WHERE t.league_id = $1 AND t.season = $2
        """,
        league_id, season,
    )
    return {r["team_id"]: first_name(r["display_name"], r["goes_by"]) for r in rows}


def _record(wins: int, losses: int, ties: int = 0) -> str:
    return f"{wins}-{losses}" + (f"-{ties}" if ties else "")


async def _week_state(season: int, week: int) -> str:
    try:
        games = await get_week_scoreboard(week, season)
    except Exception:
        return "unknown"
    if is_week_final(games):
        return "final"
    if any(g.get("state") == "in" for g in games):
        return "live"
    return "upcoming"


# ---------------------------------------------------------------- matchup
async def matchup_card(conn, league_id: int, ref: dict) -> dict | None:
    detail = await build_matchup_detail(conn, int(ref["matchup_id"]))
    if detail is None or detail["league_id"] != league_id:
        return None
    season, week = detail["season"], detail["week"]
    names = await _goes_by(conn, league_id, season)
    sides = {}
    for key in ("home", "away"):
        s = detail[key]
        starters = [p for p in s["roster"] if p["lineup_slot"] not in _BENCH]
        sides[key] = {
            "name": names.get(s["team_id"]) or first_name(s["owner_name"]),
            "team_name": s["team_name"],
            "record": s["record"],
            "score": round(s["score"] or 0, 1),
            "projected": round(s["projected_total"] or 0, 1) if s.get("projected_total") is not None else None,
            "win_probability": s.get("win_probability"),
            "left_to_play": sum(1 for p in starters if p.get("game_status") not in ("in_progress", "final")),
            "_starters": starters,
            "_bench_crime": s.get("bench_crime"),
        }
    state = await _week_state(season, week)
    if state == "final" and all(p.get("game_status") in (None, "final") for k in sides for p in sides[k]["_starters"]):
        status = "final"
    elif any(p.get("game_status") == "in_progress" for k in sides for p in sides[k]["_starters"]):
        status = "live"
    else:
        status = "final" if state == "final" else "upcoming"

    home, away = sides["home"], sides["away"]
    leader = home if home["score"] >= away["score"] else away
    trailer = away if leader is home else home
    stars = sorted(leader["_starters"], key=lambda p: p.get("points_scored") or 0, reverse=True)[:2]
    crime = trailer["_bench_crime"]
    out = {
        "season": season,
        "week": week,
        "status": status,
        "is_playoff": detail.get("is_playoff", False),
        "rivalry": (detail.get("rivalry") or {}).get("name"),
        "home": {k: v for k, v in home.items() if not k.startswith("_")},
        "away": {k: v for k, v in away.items() if not k.startswith("_")},
        "leader": "home" if leader is home else "away",
        "margin": round(abs(home["score"] - away["score"]), 1),
        "stars": [
            {
                "name": p["player_name"],
                "position": p["position"],
                "pro_team": p.get("pro_team"),
                "points": round(p.get("points_scored") or 0, 1),
                "line": stat_line(p.get("raw_stats"), p["position"]),
                "headshot": _HEADSHOT.format(p["player_id"]) if p.get("player_id") and str(p["player_id"]).isdigit() else None,
            }
            for p in stars
            if (p.get("points_scored") or 0) > 0
        ],
        "bench_crime": (
            {"name": trailer["name"], "bench_player": crime["bench_player"], "started_player": crime["started_player"],
             "points": round(float(crime["points_diff"]), 1)}
            if crime and status == "final" else None
        ),
    }
    return out


# ---------------------------------------------------------------- recap
async def recap_card(conn, league_id: int, ref: dict) -> dict | None:
    season, week = int(ref["season"]), int(ref["week"])
    narrative = await narrative_engine.get_cached_weekly_narrative(conn, season, week, league_id)
    if not narrative or narrative["kind"] != "recap" or not narrative.get("text"):
        return None
    if not await recap_release.is_recap_released(conn, season, week):
        return None
    names = await _goes_by(conn, league_id, season)
    matchups = [dict(m) for m in await league_queries.list_week_matchups(conn, season, week, league_id)]
    scores = [(m["home_team_id"], m["home_score"]) for m in matchups] + [(m["away_team_id"], m["away_score"]) for m in matchups]
    scores = [(t, float(s)) for t, s in scores if s is not None]
    top = max(scores, key=lambda x: x[1]) if scores else None
    _, meltdown = await weekly_awards.get_overachiever_and_meltdown(conn, season, week, league_id)
    crime = await weekly_awards.get_biggest_bench_crime(conn, season, week, league_id)
    owed = []
    team_by_owner = {
        r["owner_id"]: r["id"]
        for r in await conn.fetch("SELECT id, owner_id FROM teams_by_season WHERE league_id = $1 AND season = $2", league_id, season)
    }
    for owner_id, chug in (await chug_queries.get_chug_standing_by_owner(conn, season, league_id)).items():
        if float(chug["outstanding_owed"] or 0) + float(chug["fined_owed"] or 0) > 0 and owner_id in team_by_owner:
            owed.append(names.get(team_by_owner[owner_id], ""))
    return {
        "season": season,
        "week": week,
        "headline": headline(narrative["text"]),
        "teaser": narrative["text"].strip()[:420],
        "top_score": {"name": names.get(top[0], ""), "points": round(top[1], 1)} if top else None,
        "meltdown": {"name": names.get(meltdown["team_id"], ""), "under": round(-meltdown["diff"], 1)} if meltdown and meltdown["diff"] < 0 else None,
        "bench_crime": {"name": names.get(crime["team_id"], ""), "points": round(float(crime["points_diff"]), 1)} if crime else None,
        "chugs_owed": [n for n in owed if n][:4],
    }


# ---------------------------------------------------------------- standings
async def standings_card(conn, league_id: int, ref: dict) -> dict | None:
    season = int(ref["season"])
    rows = await league_queries.get_standings(conn, season, league_id)
    if not rows:
        return None
    names = await _goes_by(conn, league_id, season)
    week = await conn.fetchval("SELECT current_week FROM league_state WHERE season = $1", season)
    return {
        "season": season,
        "week": week,
        "playoff_teams": await league_queries.get_playoff_team_count(conn, season, league_id),
        "teams": [
            {
                "seed": i,
                "name": names.get(r["team_id"]) or first_name(r["owner_name"]),
                "team_name": r["team_name"],
                "record": _record(r["wins"], r["losses"], r["ties"]),
                "points_for": round(float(r["points_for"] or 0)),
            }
            for i, r in enumerate(rows, 1)
        ],
    }


# ---------------------------------------------------------------- power rankings
async def power_card(conn, league_id: int, ref: dict) -> dict | None:
    season, week = int(ref["season"]), int(ref["week"])
    rows = await power_rankings.get_week_power_rankings(conn, season, week, league_id)
    if not rows:
        return None
    names = await _goes_by(conn, league_id, season)

    def why(r: dict) -> str | None:
        luck = r.get("luck_wins")
        if luck is not None and luck <= -0.75:
            return f"{r.get('record') or ''}, {abs(luck):.1f} wins unlucky".strip(", ")
        if luck is not None and luck >= 0.75:
            return f"{r.get('record') or ''}, {luck:.1f} wins lucky".strip(", ")
        return r.get("note") or r.get("record")

    return {
        "season": season,
        "week": week,
        "teams": [
            {
                "rank": r["power_rank"],
                "name": names.get(r["team_id"]) or first_name(r["owner_name"]),
                "team_name": r["team_name"],
                "record": r.get("record"),
                "movement": r.get("movement"),
                "why": why(r),
            }
            for r in sorted(rows, key=lambda r: r["power_rank"])
        ],
    }


# ---------------------------------------------------------------- week awards
async def awards_card(conn, league_id: int, ref: dict) -> dict | None:
    season, week = int(ref["season"]), int(ref["week"])
    if await _week_state(season, week) not in ("final", "unknown"):
        return None
    names = await _goes_by(conn, league_id, season)
    matchups = [dict(m) for m in await league_queries.list_week_matchups(conn, season, week, league_id)]
    scores = [(m["home_team_id"], m["home_score"]) for m in matchups] + [(m["away_team_id"], m["away_score"]) for m in matchups]
    scores = [(t, float(s)) for t, s in scores if s is not None and float(s) > 0]
    over, melt = await weekly_awards.get_overachiever_and_meltdown(conn, season, week, league_id)
    crime = await weekly_awards.get_biggest_bench_crime(conn, season, week, league_id)
    clutch, choke = await weekly_awards.get_clutch_choke_of_week(conn, season, week, league_id)

    by_team_name = {
        r["team_name"]: names.get(r["id"], "")
        for r in await conn.fetch("SELECT id, team_name FROM teams_by_season WHERE league_id = $1 AND season = $2", league_id, season)
    }

    def who(team_id) -> str:
        return names.get(team_id, "")

    awards = []
    if scores:
        best = max(scores, key=lambda x: x[1])
        awards.append({"tone": "glory", "title": "Boom week", "name": who(best[0]), "value": f"{best[1]:.1f}", "note": "Top score of the week"})
    if melt and melt["diff"] < 0:
        awards.append({"tone": "shame", "title": "Meltdown", "name": who(melt["team_id"]), "value": f"−{-melt['diff']:.1f}", "note": "Under projection"})
    if over and over["diff"] > 0:
        awards.append({"tone": "glory", "title": "Overachiever", "name": who(over["team_id"]), "value": f"+{over['diff']:.1f}", "note": "Over projection"})
    if crime:
        awards.append({"tone": "shame", "title": "Bench crime", "name": who(crime["team_id"]), "value": f"{float(crime['points_diff']):.1f}",
                       "note": f"Sat {crime['bench_player']} for {crime['started_player']}"})
    if clutch:
        awards.append({"tone": "glory", "title": "Clutch", "name": by_team_name.get(clutch["team_name"], ""), "value": f"by {abs(clutch['margin']):.1f}", "note": clutch["reason"].capitalize()})
    if choke:
        awards.append({"tone": "shame", "title": "Choke", "name": by_team_name.get(choke["team_name"], ""), "value": f"by {abs(choke['margin']):.1f}", "note": choke["reason"].capitalize()})
    if not awards:
        return None
    return {"season": season, "week": week, "awards": awards[:6]}


BUILDERS = {
    "matchup": matchup_card,
    "recap": recap_card,
    "standings": standings_card,
    "power": power_card,
    "awards": awards_card,
}
