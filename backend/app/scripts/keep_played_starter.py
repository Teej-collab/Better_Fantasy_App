"""
Puts a starter who already played back into a team's lineup for one week,
for scoring only — the fix for a drop made before app/domain/
locked_departures.py existed (2026-10-12: a Monday 3am waiver claim
dropped the Dallas D/ST that had started and played Sunday).

    python -m app.scripts.keep_played_starter --user 1 --league 1 --player DAL --week 5 --slot D/ST            # dry run
    python -m app.scripts.keep_played_starter --user 1 --league 1 --player DAL --week 5 --slot D/ST --apply    # do it

Adds a locked_departures row, refreshes that week's roster snapshot if
it's the current week, and recomputes the week's matchup scores. Runs
against DATABASE_URL.
"""
import argparse
import asyncio
import json

import asyncpg

from app import config
from app.domain.matchup_scoring import compute_matchup_scores_for_week
from app.queries import league as league_queries
from app.queries import roster_history as roster_history_queries


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", type=int, required=True, help="The team owner's user id")
    parser.add_argument("--league", type=int, required=True)
    parser.add_argument("--player", required=True, help="Sleeper player id (a D/ST is its team abbreviation, e.g. DAL)")
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--slot", required=True, help="The lineup slot they played from, e.g. D/ST")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    season = int(config._require("ACTIVE_SEASON"))

    conn = await asyncpg.connect(config.DATABASE_URL, statement_cache_size=0)
    report: dict = {}
    try:
        team = await conn.fetchrow(
            """
            SELECT t.id, t.team_name FROM teams_by_season t
            JOIN owner_users ou ON ou.owner_id = t.owner_id
            WHERE ou.user_id = $1 AND t.league_id = $2 AND t.season = $3
            """,
            args.user, args.league, season,
        )
        player = await conn.fetchrow(
            "SELECT sleeper_player_id, full_name, position, pro_team FROM players WHERE sleeper_player_id = $1", args.player
        )
        if team is None or player is None:
            raise SystemExit(f"Team found: {team is not None}; player found: {player is not None}")
        current_week = await league_queries.get_cached_current_week(conn, season)
        report["team"] = f"{team['id']} {team['team_name']}"
        report["player"] = f"{player['full_name']} ({player['position']}, {player['pro_team']})"
        report["current_week"] = current_week
        report["week_points"] = await conn.fetchval(
            "SELECT fantasy_points FROM player_week_stats WHERE season = $1 AND week = $2 AND sleeper_player_id = $3 AND league_id = $4",
            season, args.week, args.player, args.league,
        )
        report["on_roster_now"] = await conn.fetchval(
            "SELECT lineup_slot FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            season, team["id"], args.player,
        )
        report["drops_this_season"] = [
            {**dict(r), "created_at": r["created_at"].isoformat()}
            for r in await conn.fetch(
                "SELECT source, added_sleeper_player_id, created_at FROM roster_transactions "
                "WHERE season = $1 AND team_id = $2 AND dropped_sleeper_player_id = $3 ORDER BY created_at",
                season, team["id"], args.player,
            )
        ]
        report["others_in_slot_now"] = [
            r["full_name"]
            for r in await conn.fetch(
                "SELECT p.full_name FROM current_rosters cr JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id "
                "WHERE cr.season = $1 AND cr.team_id = $2 AND cr.lineup_slot = $3",
                season, team["id"], args.slot,
            )
        ]
        matchup_sql = (
            "SELECT id, home_team_id, away_team_id, home_score, away_score FROM matchups "
            "WHERE season = $1 AND week = $2 AND (home_team_id = $3 OR away_team_id = $3)"
        )
        before = await conn.fetchrow(matchup_sql, season, args.week, team["id"])
        report["matchup_before"] = dict(before) if before else None

        if args.apply:
            async with conn.transaction():
                await conn.execute(
                    """
                    INSERT INTO locked_departures (season, week, league_id, team_id, sleeper_player_id, lineup_slot)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (season, week, team_id, sleeper_player_id) DO UPDATE SET lineup_slot = EXCLUDED.lineup_slot
                    """,
                    season, args.week, args.league, team["id"], args.player, args.slot,
                )
                if args.week == current_week:
                    await roster_history_queries.snapshot_week(conn, season, args.week)
                await compute_matchup_scores_for_week(conn, season, args.week, args.league)
            after = await conn.fetchrow(matchup_sql, season, args.week, team["id"])
            report["matchup_after"] = dict(after) if after else None
    finally:
        await conn.close()
    print(json.dumps(report, indent=2, default=str))
    print("Done." if args.apply else "Dry run only — nothing changed. Add --apply to do it.")


if __name__ == "__main__":
    asyncio.run(main())
