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
"""
from app.domain.league_settings_import import slot_label
from app.providers.sleeper import league as sleeper

_SLEEPER_ABBR = {"WAS": "WSH"}


async def _write(conn, season: int, league_id: int, rows: list[tuple[int, str, str]]) -> int:
    """rows: (team_db_id, sleeper_player_id, slot)."""
    known = {
        r["sleeper_player_id"]
        for r in await conn.fetch(
            "SELECT sleeper_player_id FROM players WHERE sleeper_player_id = ANY($1::text[])", [p for _, p, _ in rows]
        )
    }
    rows = [r for r in rows if r[1] in known]
    async with conn.transaction():
        await conn.execute("DELETE FROM current_rosters WHERE season = $1 AND league_id = $2", season, league_id)
        await conn.executemany(
            """
            INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id)
            VALUES ($1, $2, $3, $4, 'sync', $5)
            ON CONFLICT DO NOTHING
            """,
            [(season, team, pid, slot, league_id) for team, pid, slot in rows],
        )
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
        return await _write(conn, season, league_id, rows)


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
        return await _write(conn, season, league_id, rows)
