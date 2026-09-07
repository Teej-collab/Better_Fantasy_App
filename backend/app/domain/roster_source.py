"""
Shared signal for "does this season's roster/lineup data live in
current_rosters/roster_history (this app's own in-app draft, 2026+) or
in the legacy `rosters` table (real historical seasons genuinely played
on ESPN natively, before this app's draft pivot)?" — draft_config only
ever gets a row once a season's real in-app draft is configured (see
app/routers/draft.py), so its existence is the same signal already
used elsewhere to distinguish "the new system" from historical data.

Used by boom_bust.py, bench_crimes.py, chug_debt.py, and
weekly_awards.py's get_boom_bust_leaders — all four read roster/lineup
composition for a specific week, and only the in-app-draft seasons have
that composition anywhere in current_rosters/roster_history. Past
seasons' `rosters` rows are correct as-is and must keep being read
unchanged; this only branches which table today's real season reads.
"""


async def uses_in_app_rosters(conn, season: int) -> bool:
    return bool(await conn.fetchval("SELECT EXISTS(SELECT 1 FROM draft_config WHERE season = $1)", season))
