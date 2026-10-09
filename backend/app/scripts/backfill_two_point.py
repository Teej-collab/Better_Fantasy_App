"""
Add 2-point conversions to weeks already scored before they were tracked
(2026-10; app/providers/nfl_stats/espn_public.py's two_point_conversions).

    python -m app.scripts.backfill_two_point --season 2026 --weeks 1-4           # dry run
    python -m app.scripts.backfill_two_point --season 2026 --weeks 1-4 --apply   # do it

Targeted on purpose: it adds only the two_pt_* stats (and their points
under each league's own rules) to the players' stored weeks, then
re-totals that week's matchups from the lineups that actually played —
it does not recompute anything else, so a scoring rule changed since
then can't quietly move an old score. A player who already has a
two_pt_* stat that week is left alone, so running it twice is safe.

Runs against DATABASE_URL. The dry run does everything inside a
transaction it rolls back, and prints every player credited, every
matchup score that moves, and any result that would flip.
"""
import argparse
import asyncio
import json

import asyncpg

from app import config
from app.domain.matchup_scoring import compute_matchup_scores_for_week
from app.providers.nfl_scoreboard import get_week_scoreboard
from app.providers.nfl_stats.espn_public import _fetch_summary, _parse_two_point_by_player

CATEGORIES = ("two_pt_pass", "two_pt_rush", "two_pt_rec")


class _DryRun(Exception):
    pass


def _weeks(spec: str) -> list[int]:
    if "-" in spec:
        a, b = spec.split("-", 1)
        return list(range(int(a), int(b) + 1))
    return [int(w) for w in spec.split(",")]


def _result(home: float | None, away: float | None) -> str:
    if home is None or away is None:
        return "-"
    return "home" if home > away else "away" if away > home else "tie"


async def _credits_for_week(season: int, week: int) -> dict[int, dict[str, int]]:
    """{espn_id: {category: count}} across the week's finished games."""
    games = await get_week_scoreboard(week=week, year=season)
    out: dict[int, dict[str, int]] = {}
    for game in games:
        if not game.get("id") or game.get("state") != "post":
            continue
        credits, unmatched = _parse_two_point_by_player(await _fetch_summary(game["id"]))
        for abbr, name, category in unmatched:
            print(f"  week {week}: couldn't match {name} ({abbr}, {category}) — skipped")
        for espn_id, buckets in credits.items():
            mine = out.setdefault(espn_id, {})
            for category, count in buckets.items():
                mine[category] = mine.get(category, 0) + int(count)
    return out


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--weeks", required=True, help="e.g. 1-4 or 1,2,3")
    parser.add_argument("--apply", action="store_true", help="Save the changes (default is a dry run)")
    args = parser.parse_args()

    conn = await asyncpg.connect(config.DATABASE_URL, statement_cache_size=0)
    flips: list[str] = []
    try:
        # espn_player_id isn't unique in players, so every match is checked;
        # only the one that was scored that week has a row.
        crosswalk: dict[int, list[tuple[str, str]]] = {}
        for r in await conn.fetch(
            "SELECT espn_player_id, sleeper_player_id, full_name FROM players WHERE espn_player_id IS NOT NULL"
        ):
            crosswalk.setdefault(r["espn_player_id"], []).append((r["sleeper_player_id"], r["full_name"]))
        league_ids = [
            r["league_id"]
            for r in await conn.fetch(
                "SELECT DISTINCT league_id FROM teams_by_season WHERE season = $1 ORDER BY league_id", args.season
            )
        ]
        credits_by_week = {week: await _credits_for_week(args.season, week) for week in _weeks(args.weeks)}

        try:
            async with conn.transaction():
                for week, credits in credits_by_week.items():
                    print(f"\nWeek {week}: {sum(sum(v.values()) for v in credits.values())} two-point credits")
                    for league_id in league_ids:
                        rules = {
                            r["stat_category"]: float(r["points_per_unit"])
                            for r in await conn.fetch(
                                "SELECT stat_category, points_per_unit FROM league_scoring_rules"
                                " WHERE season = $1 AND league_id = $2",
                                args.season, league_id,
                            )
                        }
                        changed = 0
                        players = [(p, b) for e, b in credits.items() for p in crosswalk.get(e, [])]
                        for (sleeper_id, name), buckets in players:
                            row = await conn.fetchrow(
                                "SELECT raw_stats, fantasy_points FROM player_week_stats"
                                " WHERE season = $1 AND week = $2 AND sleeper_player_id = $3 AND league_id = $4",
                                args.season, week, sleeper_id, league_id,
                            )
                            if row is None:
                                continue
                            stats = row["raw_stats"]
                            stats = json.loads(stats) if isinstance(stats, str) else dict(stats or {})
                            if any(c in stats for c in CATEGORIES):
                                continue
                            delta = 0.0
                            for category, count in buckets.items():
                                stats[category] = count
                                delta += count * rules.get(category, 0.0)
                            await conn.execute(
                                "UPDATE player_week_stats SET raw_stats = $1::jsonb,"
                                " fantasy_points = (fantasy_points + $2)::numeric(10,2), computed_at = now()"
                                " WHERE season = $3 AND week = $4 AND sleeper_player_id = $5 AND league_id = $6",
                                json.dumps(stats), delta, args.season, week, sleeper_id, league_id,
                            )
                            changed += 1
                            print(f"  league {league_id}: {name} +{delta:g} ({', '.join(f'{c} {n}' for c, n in buckets.items())})")
                        if not changed:
                            continue

                        before = {
                            r["id"]: r
                            for r in await conn.fetch(
                                "SELECT m.id, m.home_score, m.away_score, th.team_name AS home, ta.team_name AS away"
                                " FROM matchups m JOIN teams_by_season th ON th.id = m.home_team_id"
                                " JOIN teams_by_season ta ON ta.id = m.away_team_id"
                                " WHERE m.season = $1 AND m.week = $2 AND m.league_id = $3",
                                args.season, week, league_id,
                            )
                        }
                        await compute_matchup_scores_for_week(conn, args.season, week, league_id)
                        for r in await conn.fetch(
                            "SELECT id, home_score, away_score FROM matchups WHERE season = $1 AND week = $2 AND league_id = $3",
                            args.season, week, league_id,
                        ):
                            b = before[r["id"]]
                            if (b["home_score"], b["away_score"]) == (r["home_score"], r["away_score"]):
                                continue
                            line = (
                                f"  league {league_id} matchup {r['id']}: {b['home']} {b['home_score']} → {r['home_score']}"
                                f" vs {b['away']} {b['away_score']} → {r['away_score']}"
                            )
                            print(line)
                            if _result(b["home_score"], b["away_score"]) != _result(r["home_score"], r["away_score"]):
                                flips.append(f"week {week}{line}")
                if not args.apply:
                    raise _DryRun
        except _DryRun:
            pass
    finally:
        await conn.close()

    print("\nResults that flip:" if flips else "\nNo matchup results flip.")
    for f in flips:
        print(f)
    print("Saved." if args.apply else "Dry run only — nothing changed. Add --apply to save.")


if __name__ == "__main__":
    asyncio.run(main())
