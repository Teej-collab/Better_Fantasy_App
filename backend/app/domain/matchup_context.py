"""
Everything the matchup expand-card needs, for every matchup in a week,
batched to avoid a fetch storm: each team's record (from the existing
standings query), hot/cold streak (batched — see app/domain/streaks.py),
real all-time head-to-head (any owner pair, not just curated rivalries —
see queries/league.py's get_head_to_head), whether the matchup is a
curated rivalry, which matchup is the week's Game of the Week (existing
find_game_of_the_week, unchanged), and each side's roster plus starters'
combined projected total.

Ported from the shape of Fantasy_Helper's bot/discord_bot/embeds/
preview_embed.py (build_preview_embed / build_matchup_detail_embed),
which already assembled exactly this same set of facts per matchup for
the Discord /preview command — just returning structured data here
instead of building a Discord embed, and computing head-to-head live
for every matchup instead of only the ones with a curated rivalry entry.

`narrative` is deliberately always null — the LLM narrative engine is a
separate, explicitly-not-yet-turned-on feature (real Anthropic API cost
per generation, see TODO.md). This is a stub field for the frontend to
render a placeholder against, not a promise it'll be null forever.
"""
from app.domain.streaks import get_team_streaks
from app.domain.team_profile import find_game_of_the_week
from app.queries import league as queries

_STARTER_EXCLUDED_SLOTS = {"BE", "IR"}


def _projected_total(roster_rows) -> float | None:
    starters = [r for r in roster_rows if r["lineup_slot"] not in _STARTER_EXCLUDED_SLOTS]
    if not starters:
        return None
    return round(sum(float(r["points_projected"] or 0) for r in starters), 2)


def _roster_list(roster_rows):
    return [
        {
            "player_name": r["player_name"],
            "position": r["position"],
            "lineup_slot": r["lineup_slot"],
            "points_scored": float(r["points_scored"]) if r["points_scored"] is not None else None,
            "points_projected": float(r["points_projected"]) if r["points_projected"] is not None else None,
            "player_id": r["player_id"],
            "pro_team": r["pro_team"],
        }
        for r in roster_rows
    ]


def _side_dict(team_row, score, standings_row, streak, roster_rows):
    return {
        "team_id": team_row["team_id"],
        "team_name": team_row["team_name"],
        "owner_id": team_row["owner_id"],
        "owner_name": team_row["owner_name"],
        "score": float(score) if score is not None else None,
        "record": (
            f"{standings_row['wins']}-{standings_row['losses']}"
            + (f"-{standings_row['ties']}" if standings_row["ties"] else "")
            if standings_row
            else None
        ),
        "streak": streak,
        "projected_total": _projected_total(roster_rows),
        "roster": _roster_list(roster_rows),
    }


def _rivalry_dict(rivalry_row, home_owner_id):
    is_home_a = rivalry_row["owner_a_id"] == home_owner_id
    return {
        "name": rivalry_row["name"],
        "emoji": rivalry_row["emoji"],
        "tagline": rivalry_row["tagline"],
        "description": rivalry_row["description"],
        "tier": rivalry_row["tier"],
        "all_time_wins_home": rivalry_row["all_time_wins_a"] if is_home_a else rivalry_row["all_time_wins_b"],
        "all_time_wins_away": rivalry_row["all_time_wins_b"] if is_home_a else rivalry_row["all_time_wins_a"],
    }


async def build_week_matchup_context(conn, season: int, week: int):
    matchups = [dict(m) for m in await queries.list_week_matchups(conn, season, week)]
    if not matchups:
        return {"season": season, "week": week, "game_of_the_week_matchup_id": None, "matchups": []}

    team_ids = list({m["home_team_id"] for m in matchups} | {m["away_team_id"] for m in matchups})
    standings_by_team = {r["team_id"]: r for r in await queries.get_standings(conn, season)}
    streaks_by_team = await get_team_streaks(conn, season, team_ids)

    gow = await find_game_of_the_week(conn, season, week, matchups)
    gow_id = None
    if gow:
        for m in matchups:
            if m["home_team_id"] == gow["home_team_id"] and m["away_team_id"] == gow["away_team_id"]:
                gow_id = m["matchup_id"]
                break

    results = []
    for m in matchups:
        home_team = await queries.get_team(conn, m["home_team_id"])
        away_team = await queries.get_team(conn, m["away_team_id"])
        home_roster = await queries.get_roster(conn, m["home_team_id"], week)
        away_roster = await queries.get_roster(conn, m["away_team_id"], week)

        rivalry = await queries.get_rivalry_for_owners(conn, home_team["owner_id"], away_team["owner_id"])
        h2h = await queries.get_head_to_head(conn, home_team["owner_id"], away_team["owner_id"])

        results.append(
            {
                "matchup_id": m["matchup_id"],
                "is_playoff": m["is_playoff"],
                "is_game_of_the_week": m["matchup_id"] == gow_id,
                "is_rivalry": rivalry is not None,
                "rivalry": _rivalry_dict(rivalry, home_team["owner_id"]) if rivalry else None,
                "head_to_head": {
                    # get_head_to_head was called with home's owner_id as
                    # owner_a_id, so wins_a/"a" is always home's side here.
                    "wins_home": h2h["wins_a"],
                    "wins_away": h2h["wins_b"],
                    "ties": h2h["ties"],
                    "last_season": h2h["last_season"],
                    "last_week": h2h["last_week"],
                    "recent_meetings": [
                        {
                            "season": g["season"],
                            "week": g["week"],
                            "home_won": g["winner"] == "a",
                            "tie": g["winner"] == "tie",
                            "home_score": g["a_score"],
                            "away_score": g["b_score"],
                        }
                        for g in h2h["recent_games"]
                    ],
                },
                "home": _side_dict(
                    home_team, m["home_score"], standings_by_team.get(m["home_team_id"]),
                    streaks_by_team.get(m["home_team_id"], "neutral"), home_roster,
                ),
                "away": _side_dict(
                    away_team, m["away_score"], standings_by_team.get(m["away_team_id"]),
                    streaks_by_team.get(m["away_team_id"], "neutral"), away_roster,
                ),
                "narrative": None,
            }
        )

    return {"season": season, "week": week, "game_of_the_week_matchup_id": gow_id, "matchups": results}
