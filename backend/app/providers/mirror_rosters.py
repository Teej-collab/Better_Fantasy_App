"""
Mirror mode's roster copy (2026-10-24): every team's current roster and
lineup on ESPN or Sleeper, written into current_rosters so My Team,
player cards, trade values and everything else built on it show the
league as it really is. The scheduler runs it every few minutes for
each connected league (app/scheduler.py's mirror roster job); an add,
drop, trade or lineup change on the source shows up here on the next
pass.

The whole league's rows are replaced in one transaction, so a reader
never sees half a league. A player this app doesn't know (no players
row, or an ESPN id with no match) is skipped.

Each pass also compares every team's roster before and after the copy
and logs the adds and drops to roster_transactions (source 'sync',
2026-11-05) — the source league's own history never reaches this app,
and these rows feed that league's activity feed and the league-wide
Trending page. Nothing is logged before the league has drafted (every
pick would look like an add) or on its first copy (empty before).
"""
import logging

from app.domain.league_settings_import import slot_label
from app.providers.sleeper import league as sleeper

logger = logging.getLogger(__name__)

_SLEEPER_ABBR = {"WAS": "WSH"}

# More changes than this to one team in a single pass (a few minutes) is
# a source glitch or a commissioner reset, not real roster moves.
_MAX_MOVES_PER_TEAM = 6

_DRAFTED_SLEEPER_STATUSES = {"in_season", "post_season", "complete"}


def roster_moves(
    before: dict[int, set[str]], after: dict[int, set[str]]
) -> list[tuple[int, str | None, str | None]]:
    """(team_id, added, dropped) per move, an add and a drop on the same
    team paired into one row the way an in-app swap is logged. A player
    who left one team and joined another in the same pass was traded,
    not dropped and picked up, so neither side is logged. Only teams
    with a roster on both sides count — a team missing from one side is
    a new team or a bad fetch, not 15 adds or 15 drops."""
    teams = [t for t in after if before.get(t) and after.get(t)]
    added = {t: after[t] - before[t] for t in teams}
    dropped = {t: before[t] - after[t] for t in teams}
    traded = set().union(*added.values()) & set().union(*dropped.values()) if teams else set()
    moves: list[tuple[int, str | None, str | None]] = []
    for t in teams:
        adds = sorted(added[t] - traded)
        drops = sorted(dropped[t] - traded)
        if not adds and not drops or len(adds) + len(drops) > _MAX_MOVES_PER_TEAM:
            continue
        for i in range(max(len(adds), len(drops))):
            moves.append((t, adds[i] if i < len(adds) else None, drops[i] if i < len(drops) else None))
    return moves


async def _write(conn, season: int, league_id: int, rows: list[tuple[int, str, str]], drafted: bool) -> int:
    """rows: (team_db_id, sleeper_player_id, slot). drafted: the source
    league's draft is done, so roster changes are real adds and drops."""
    known = {
        r["sleeper_player_id"]
        for r in await conn.fetch(
            "SELECT sleeper_player_id FROM players WHERE sleeper_player_id = ANY($1::text[])", [p for _, p, _ in rows]
        )
    }
    rows = [r for r in rows if r[1] in known]
    async with conn.transaction():
        before: dict[int, set[str]] = {}
        for r in await conn.fetch(
            "SELECT team_id, sleeper_player_id FROM current_rosters WHERE season = $1 AND league_id = $2",
            season, league_id,
        ):
            before.setdefault(r["team_id"], set()).add(r["sleeper_player_id"])
        await conn.execute("DELETE FROM current_rosters WHERE season = $1 AND league_id = $2", season, league_id)
        await conn.executemany(
            """
            INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id)
            VALUES ($1, $2, $3, $4, 'sync', $5)
            ON CONFLICT DO NOTHING
            """,
            [(season, team, pid, slot, league_id) for team, pid, slot in rows],
        )
        if drafted:
            after: dict[int, set[str]] = {}
            for team, pid, _ in rows:
                after.setdefault(team, set()).add(pid)
            moves = roster_moves(before, after)
            if moves:
                # A savepoint: a failed log never costs the roster copy itself.
                try:
                    async with conn.transaction():
                        await conn.executemany(
                            """
                            INSERT INTO roster_transactions
                                (season, league_id, team_id, added_sleeper_player_id, dropped_sleeper_player_id, source)
                            VALUES ($1, $2, $3, $4, $5, 'sync')
                            """,
                            [(season, league_id, team, add, drop) for team, add, drop in moves],
                        )
                except Exception:
                    logger.warning("Couldn't log mirror roster moves for league %s", league_id, exc_info=True)
    return len(rows)


async def _teams(conn, season: int, league_id: int) -> dict[int, int]:
    return {
        r["espn_team_id"]: r["id"]
        for r in await conn.fetch(
            "SELECT id, espn_team_id FROM teams_by_season WHERE season = $1 AND league_id = $2", season, league_id
        )
    }


async def sync_sleeper(pool, season: int, league_id: int, sleeper_league_id: str) -> int:
    league = await sleeper.fetch_league(sleeper_league_id)
    rosters = await sleeper._get(f"/league/{sleeper_league_id}/rosters") or []
    starter_slots = [s for s in (league.get("roster_positions") or []) if s not in ("BN", "IR", "TAXI")]
    async with pool.acquire() as conn:
        teams = await _teams(conn, season, league_id)
        rows: list[tuple[int, str, str]] = []
        for roster in rosters:
            team = teams.get(roster["roster_id"])
            if team is None:
                continue
            slot_of: dict[str, str] = {}
            for i, pid in enumerate(roster.get("starters") or []):
                if pid and pid != "0" and i < len(starter_slots):
                    slot_of[pid] = slot_label("sleeper", starter_slots[i])
            for pid in roster.get("reserve") or []:
                slot_of.setdefault(pid, "IR")
            for pid in roster.get("taxi") or []:
                slot_of.setdefault(pid, "TAXI")
            for pid in roster.get("players") or []:
                rows.append((team, _SLEEPER_ABBR.get(pid, pid), slot_of.get(pid, "BE")))
        return await _write(conn, season, league_id, rows, league.get("status") in _DRAFTED_SLEEPER_STATUSES)


async def sync_espn(pool, season: int, league_id: int, provider) -> int:
    league = provider._league(season)
    async with pool.acquire() as conn:
        teams = await _teams(conn, season, league_id)
        espn_ids = [p.playerId for t in league.teams for p in (t.roster or [])]
        by_espn = {
            r["espn_player_id"]: r["sleeper_player_id"]
            for r in await conn.fetch(
                "SELECT espn_player_id, sleeper_player_id FROM players WHERE espn_player_id = ANY($1::int[])", espn_ids
            )
        }
        rows = []
        for t in league.teams:
            team = teams.get(t.team_id)
            if team is None:
                continue
            for p in t.roster or []:
                pid = by_espn.get(p.playerId)
                if pid:
                    rows.append((team, pid, slot_label("espn", getattr(p, "lineupSlot", "BE") or "BE")))
        # espn_api only fills league.draft once ESPN says the draft is done.
        return await _write(conn, season, league_id, rows, bool(league.draft))
