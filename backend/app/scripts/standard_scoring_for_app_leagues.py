"""
Move leagues created in the app off League #1's house scoring rules
(2026-10-28). New leagues used to copy League #1's rules; they start
on standard PPR now (scoring_catalog.STANDARD_RULES), and this brings
the ones made before that in line.

    python -m app.scripts.standard_scoring_for_app_leagues            # dry run
    python -m app.scripts.standard_scoring_for_app_leagues --apply    # do it

Only leagues created in the app: League #1, any league with an ESPN or
Sleeper connection, and any league that switched over from ESPN or
Sleeper are left alone (their scoring is their platform's).

Only the house rules change, and only where a league still has League
#1's value, so a commissioner's own edit is never overwritten:
a QB tackle (15 → 0), field goals by the yard (0.1/yd → 3/4/5 by
distance), missed-FG penalties (→ -1 each) and 300–349 yards allowed
(1 → 0). PPR / Half / Standard picks and every other rule stay as they
are. Applies to the active season from now on; weeks already scored
keep their scores.

Runs against DATABASE_URL. The dry run prints every league and change
and saves nothing.
"""
import argparse
import asyncio

import asyncpg

from app import config
from app.config import DEFAULT_LEAGUE_ID, _require

# stat: (League #1's house value, standard value)
HOUSE_TO_STANDARD: dict[str, tuple[float, float]] = {
    "qb_tackle": (15, 0),
    "fg_yds": (0.1, 0),
    "fg_miss_0_29": (-5, -1),
    "fg_miss_30_39": (-3, -1),
    "fg_miss_50_plus": (0, -1),
    "yds_allow_300_349": (1, 0),
}
FG_MADE = {"fg_made_0_39": 3.0, "fg_made_40_49": 4.0, "fg_made_50_plus": 5.0}


async def _app_leagues(conn) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        SELECT l.id, l.name,
               EXISTS (SELECT 1 FROM commish_changes c WHERE c.league_id = l.id AND c.area = 'scoring') AS edited
        FROM leagues l
        WHERE l.id <> $1
          AND NOT EXISTS (SELECT 1 FROM league_espn_connections e WHERE e.league_id = l.id)
          AND NOT EXISTS (SELECT 1 FROM league_sleeper_connections s WHERE s.league_id = l.id)
          AND NOT EXISTS (SELECT 1 FROM league_switches w WHERE w.league_id = l.id)
        ORDER BY l.id
        """,
        DEFAULT_LEAGUE_ID,
    )


def _changes(rules: dict[str, float]) -> dict[str, float]:
    out: dict[str, float] = {}
    for key, (house, standard) in HOUSE_TO_STANDARD.items():
        if key in rules and abs(rules[key] - house) < 1e-9:
            out[key] = standard
    # Field goals by distance replace by-the-yard; only when by-the-yard
    # is being turned off, so a kick never scores twice.
    if "fg_yds" in out and not any(rules.get(k) for k in FG_MADE):
        out.update(FG_MADE)
    return out


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Save the changes (default is a dry run)")
    args = parser.parse_args()
    season = int(_require("ACTIVE_SEASON"))

    conn = await asyncpg.connect(config.DATABASE_URL, statement_cache_size=0)
    try:
        leagues = await _app_leagues(conn)
        print(f"{len(leagues)} league(s) created in the app (season {season}):")
        changed = 0
        async with conn.transaction():
            for league in leagues:
                rules = {
                    r["stat_category"]: float(r["points_per_unit"])
                    for r in await conn.fetch(
                        "SELECT stat_category, points_per_unit FROM league_scoring_rules WHERE league_id = $1 AND season = $2",
                        league["id"], season,
                    )
                }
                played = await conn.fetchval(
                    "SELECT count(DISTINCT week) FROM matchups WHERE league_id = $1 AND season = $2 "
                    "AND (home_score > 0 OR away_score > 0)",
                    league["id"], season,
                )
                changes = _changes(rules)
                note = " (commissioner has edited scoring)" if league["edited"] else ""
                print(f"\n  #{league['id']} {league['name']}{note}: {played} week(s) played")
                if not changes:
                    print("    already standard, nothing to change")
                    continue
                changed += 1
                for key, value in changes.items():
                    print(f"    {key}: {rules.get(key, '—')} → {value:g}")
                if args.apply:
                    await conn.executemany(
                        "INSERT INTO league_scoring_rules (season, stat_category, points_per_unit, league_id) "
                        "VALUES ($1, $2, $3, $4) ON CONFLICT (season, stat_category, league_id) "
                        "DO UPDATE SET points_per_unit = EXCLUDED.points_per_unit",
                        [(season, key, value, league["id"]) for key, value in changes.items()],
                    )
        print(f"\n{changed} league(s) {'updated' if args.apply else 'would change (dry run, nothing saved)'}.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
