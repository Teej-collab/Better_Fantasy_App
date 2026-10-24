"""
Mirror mode upkeep and the switch to The Weekend (2026-10-24).

Mirror mode (app/domain/league_mode.py): a league connected to ESPN or
Sleeper. `refresh` copies its rosters (every few minutes, from the
scheduler) and, with settings=True, its rules: scoring, roster slots and
playoffs, so points here match the source.

The switch: once the league is here, the commissioner moves it over for
good. It never happens mid-week. Asked for while any game of the current
week has kicked off, it waits for the next week (the scheduler performs
it at the Tuesday flip); otherwise it happens on the spot. Performing it:
  1. a last full sync, the rosters and the rules (refresh);
  2. waivers: the source's waiver type and FAAB budget, and each team's
     FAAB already spent (faab_carryover, read by waivers.faab_remaining);
  3. the rest of the regular season's schedule (who plays whom);
  4. the connection is removed — this app is the source of truth from
     here, every roster move unlocks and its engine scores the league;
  5. everyone is told (push + Commish Corner) and it's in the change log.
"""
import json
import logging

from app.domain import league_settings_import as settings_import
from app.domain.league_mode import PLATFORM_NAMES, mirror_platform
from app.providers import mirror_rosters
from app.providers.espn.adapter import ESPNProvider
from app.providers.espn.config import config_for_connection
from app.providers.nfl_scoreboard import get_week_scoreboard
from app.providers.sleeper import league as sleeper
from app.providers.sleeper.league import SleeperProvider
from app.queries import league_espn_connections as espn_connections
from app.queries import league_sleeper_connections as sleeper_connections

logger = logging.getLogger(__name__)

LAST_REGULAR_WEEK = 17


async def _connection(conn, league_id: int, platform: str):
    store = sleeper_connections if platform == "sleeper" else espn_connections
    return await store.get_connection(conn, league_id)


def _provider(platform: str, row, season: int):
    if platform == "sleeper":
        return SleeperProvider(row["sleeper_league_id"])
    return ESPNProvider(config_for_connection(row, season))


async def refresh(pool, league_id: int, season: int, settings: bool = False) -> dict:
    """Copies a mirrored league's rosters, and with settings=True its
    rules too. Returns what it did; a league not in mirror mode is a no-op."""
    async with pool.acquire() as conn:
        platform = await mirror_platform(conn, league_id)
        row = await _connection(conn, league_id, platform) if platform else None
    if row is None:
        return {"mirrored": False}
    out: dict = {"mirrored": True, "platform": platform}
    if platform == "sleeper":
        out["players"] = await mirror_rosters.sync_sleeper(pool, season, league_id, row["sleeper_league_id"])
    else:
        out["players"] = await mirror_rosters.sync_espn(pool, season, league_id, _provider("espn", row, season))
    if settings:
        translated = await translate(platform, row, season)
        async with pool.acquire() as conn:
            await settings_import.apply(conn, league_id, season, translated)
            table = "league_sleeper_connections" if platform == "sleeper" else "league_espn_connections"
            await conn.execute(
                f"UPDATE {table} SET import_notes = $2::jsonb WHERE league_id = $1",  # noqa: S608 — fixed names
                league_id, json.dumps(translated["notes"]),
            )
        out["notes"] = translated["notes"]
    return out


async def translate(platform: str, row, season: int) -> dict:
    if platform == "sleeper":
        return settings_import.translate_sleeper(await sleeper.fetch_league(row["sleeper_league_id"]))
    return settings_import.translate_espn(_provider("espn", row, season)._league(season))


# ---- Status -----------------------------------------------------------------------


async def status(conn, league_id: int, season: int) -> dict:
    platform = await mirror_platform(conn, league_id)
    switch = await conn.fetchrow("SELECT * FROM league_switches WHERE league_id = $1", league_id)
    total = await conn.fetchval("SELECT count(*) FROM teams_by_season WHERE league_id = $1 AND season = $2", league_id, season)
    unclaimed = [
        r["team_name"]
        for r in await conn.fetch(
            """
            SELECT t.team_name FROM teams_by_season t
            WHERE t.league_id = $1 AND t.season = $2
              AND NOT EXISTS (SELECT 1 FROM owner_users ou WHERE ou.owner_id = t.owner_id)
            ORDER BY t.team_name
            """,
            league_id, season,
        )
    ]
    notes = None
    if platform:
        table = "league_sleeper_connections" if platform == "sleeper" else "league_espn_connections"
        raw = await conn.fetchval(f"SELECT import_notes FROM {table} WHERE league_id = $1", league_id)  # noqa: S608
        notes = json.loads(raw) if isinstance(raw, str) else raw
    pending = switch is not None and switch["completed_at"] is None
    return {
        "mirrored": platform is not None,
        "platform": platform,
        "platform_name": PLATFORM_NAMES.get(platform) if platform else None,
        "teams": total,
        "claimed": total - len(unclaimed),
        "unclaimed": unclaimed,
        "notes": notes or [],
        "pending": {"effective_week": switch["effective_week"]} if pending else None,
        "switched_from": switch["platform"] if switch is not None and switch["completed_at"] else None,
    }


# ---- Switching ----------------------------------------------------------------------


async def _week_started(season: int, week: int) -> bool:
    games = await get_week_scoreboard(week=week, year=season)
    return any(g.get("state") != "pre" for g in games)


async def request(pool, league_id: int, season: int, user_id: int, current_week: int) -> dict:
    """The commissioner's "move us over". Happens now if this week
    hasn't kicked off, else is set for next week."""
    async with pool.acquire() as conn:
        platform = await mirror_platform(conn, league_id)
        if platform is None:
            raise ValueError("This league isn't connected to ESPN or Sleeper.")
    effective = current_week + 1 if await _week_started(season, current_week) else current_week
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO league_switches (league_id, platform, requested_by_user_id, effective_week)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (league_id) DO UPDATE SET platform = EXCLUDED.platform,
                requested_by_user_id = EXCLUDED.requested_by_user_id, requested_at = now(),
                effective_week = EXCLUDED.effective_week, completed_at = NULL
            """,
            league_id, platform, user_id, effective,
        )
    if effective == current_week:
        await perform(pool, league_id, season, current_week)
        return {"switched": True, "effective_week": effective}
    return {"switched": False, "effective_week": effective}


async def cancel(conn, league_id: int) -> None:
    await conn.execute("DELETE FROM league_switches WHERE league_id = $1 AND completed_at IS NULL", league_id)


async def perform(pool, league_id: int, season: int, current_week: int) -> dict:
    from app.domain import announcements, commish_log
    from app.domain.waiver_settings import get_waiver_settings, save_waiver_settings
    from app.providers.sync import run_full_sync

    async with pool.acquire() as conn:
        platform = await mirror_platform(conn, league_id)
        row = await _connection(conn, league_id, platform) if platform else None
        switch = await conn.fetchrow("SELECT * FROM league_switches WHERE league_id = $1", league_id)
    if row is None or switch is None:
        return {"switched": False}
    provider = _provider(platform, row, season)

    # 1. The last word from the source: results, rosters, rules.
    await run_full_sync(provider, season, season, league_id=league_id)
    await refresh(pool, league_id, season, settings=True)
    translated = await translate(platform, row, season)

    # 3. Who plays whom for the rest of the regular season.
    last = min((translated.get("playoff_start_week") or LAST_REGULAR_WEEK + 1) - 1, LAST_REGULAR_WEEK)
    for week in range(current_week, last + 1):
        try:
            await provider.sync_matchups_for_week(pool, season, week, league_id)
        except Exception:
            logger.warning("Couldn't bring week %s's schedule over (league %s)", week, league_id, exc_info=True)

    async with pool.acquire() as conn:
        # 2. Waivers, and FAAB already spent there.
        if translated.get("waiver_type") == "faab":
            current = await get_waiver_settings(conn, league_id)
            await save_waiver_settings(
                conn, league_id,
                {**current, "waiver_type": "faab", "faab_budget": translated.get("faab_budget") or current["faab_budget"]},
            )
            await _carry_faab(conn, platform, row, provider, season, league_id)

        # 4. The connection goes; this app is the source of truth now.
        store = sleeper_connections if platform == "sleeper" else espn_connections
        await store.delete_connection(conn, league_id)
        await conn.execute(
            "UPDATE league_switches SET completed_at = now(), effective_week = $2, notes = $3::jsonb WHERE league_id = $1",
            league_id, current_week, json.dumps(translated["notes"]),
        )
        await commish_log.record(
            conn, league_id, switch["requested_by_user_id"], "league",
            f"Moved the league from {PLATFORM_NAMES[platform]} to The Weekend",
        )
        # 5. Everyone hears it.
        try:
            await announcements.post(
                conn, league_id, switch["requested_by_user_id"],
                "We've moved to The Weekend",
                f"From Week {current_week} on, the league runs here: set lineups, add and drop, claim and trade in "
                f"The Weekend. {PLATFORM_NAMES[platform]} stays as it was, but moves made there won't count anymore.",
                notify=True,
            )
        except Exception:
            logger.exception("Couldn't post the switch announcement (league %s)", league_id)
    return {"switched": True, "effective_week": current_week, "notes": translated["notes"]}


async def _carry_faab(conn, platform: str, row, provider, season: int, league_id: int) -> None:
    """Each team's FAAB already spent on the source, so its balance here
    starts where it left off."""
    spent: dict[int, int] = {}
    if platform == "sleeper":
        for roster in await sleeper._get(f"/league/{row['sleeper_league_id']}/rosters") or []:
            spent[roster["roster_id"]] = int((roster.get("settings") or {}).get("waiver_budget_used") or 0)
    else:
        for team in provider._league(season).teams:
            spent[team.team_id] = int(getattr(team, "acquisition_budget_spent", 0) or 0)
    teams = {
        r["espn_team_id"]: r["id"]
        for r in await conn.fetch(
            "SELECT id, espn_team_id FROM teams_by_season WHERE season = $1 AND league_id = $2", season, league_id
        )
    }
    for source_team, amount in spent.items():
        team_id = teams.get(source_team)
        if team_id is None or not amount:
            continue
        await conn.execute(
            """
            INSERT INTO faab_carryover (league_id, season, team_id, amount) VALUES ($1, $2, $3, $4)
            ON CONFLICT (league_id, season, team_id) DO UPDATE SET amount = EXCLUDED.amount
            """,
            league_id, season, team_id, amount,
        )


async def process_due(pool, season: int, current_week: int) -> list[int]:
    """The scheduler's half: performs every switch whose week has come
    and hasn't kicked off yet."""
    async with pool.acquire() as conn:
        due = [
            r["league_id"]
            for r in await conn.fetch(
                "SELECT league_id FROM league_switches WHERE completed_at IS NULL AND effective_week <= $1", current_week
            )
        ]
    if not due or await _week_started(season, current_week):
        return []
    done = []
    for league_id in due:
        try:
            if (await perform(pool, league_id, season, current_week)).get("switched"):
                done.append(league_id)
        except Exception:
            logger.exception("League switch failed (league %s)", league_id)
    return done

