"""
Combines chug_debts (owed) with chug_scores (real completions/grades),
same rule as Fantasy_Helper's /chug_leaderboard
(bot/discord_bot/commands/chug_leaderboard.py): for a season before the
active one, completion is assumed 100% — those chugs happened in real
life before there was a bot/app around to track video proof. For the
active season, completion is the real graded-video count, capped at
what's actually owed (can't "complete" more than you owe). "owed" and
"completed" here are historical/season-summary numbers — the running
totals across all of that scope's weekly base debts — unaffected by
Jeffrey's Rule's real-time doubling/fine machinery (app/domain/
chug_standing.py), which only ever tracks "what does this owner owe
RIGHT NOW" for the single active season.

lifetime_completed is different from "completed" above: it's every
real chug an owner has ever posted, uncapped by what was ever owed —
see app/domain/chug_standing.py's module docstring on why a chug posted
with nothing owed still counts here even though it has no debt effect.

outstanding_owed/fined_owed/fine_amount only ever apply to the active
season (chug_standing has no meaning for a season that's already over)
— they're 0 on every row when a specific past season is selected.
"""
from app.queries import chug as chug_queries


async def build_chug_leaderboard(conn, active_season: int, season: int | None):
    owner_names = {
        r["owner_id"]: r["display_name"] for r in await conn.fetch("SELECT owner_id, display_name FROM owners")
    }
    completions = await chug_queries.get_chug_completions(conn)
    completions_by_key = {(r["owner_id"], r["season"]): r for r in completions}
    owed_rows = await chug_queries.get_chug_owed_by_owner(conn, season)
    lifetime_by_owner = await chug_queries.get_lifetime_completed_by_owner(conn)
    standing_by_owner = (
        await chug_queries.get_chug_standing_by_owner(conn, active_season)
        if season is None or season == active_season
        else {}
    )

    totals: dict[int, dict] = {}
    for r in owed_rows:
        owner_id = r["owner_id"]
        row_season = season if season is not None else r["season"]
        owed = r["total_owed"]
        is_past_season = row_season < active_season
        real = completions_by_key.get((owner_id, row_season))
        completed = owed if is_past_season else min((real["completed_count"] if real else 0), owed)

        if owner_id not in totals:
            standing = standing_by_owner.get(owner_id)
            totals[owner_id] = {
                "owner_id": owner_id,
                "owner_name": owner_names.get(owner_id, "Unknown"),
                "owed": 0,
                "completed": 0,
                "grades": [],
                "lifetime_completed": lifetime_by_owner.get(owner_id, 0),
                "outstanding_owed": standing["outstanding_owed"] if standing else 0,
                "fined_owed": standing["fined_owed"] if standing else 0,
                "fine_amount": (standing["fined_owed"] * 10) if standing else 0,
            }
        totals[owner_id]["owed"] += owed
        totals[owner_id]["completed"] += completed
        if real and real["avg_grade"] is not None:
            totals[owner_id]["grades"].append(float(real["avg_grade"]))

    leaderboard = []
    for t in totals.values():
        grades = t.pop("grades")
        t["avg_grade"] = round(sum(grades) / len(grades), 2) if grades else None
        leaderboard.append(t)

    leaderboard.sort(key=lambda t: t["owed"], reverse=True)
    return leaderboard
