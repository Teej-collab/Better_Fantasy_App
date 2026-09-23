"""
IR slot rules shared by every roster-acquisition path — free-agent adds
(app/domain/lineup_engine.py), waiver claims (app/domain/waivers.py) and
trades (app/domain/trades.py). ESPN's standard behavior, confirmed with
the commissioner 2026-09-23:

- A player in the IR slot doesn't count against the roster limit —
  IR is an extra spot on top of starters + bench (see
  roster_slots.total_draftable_slots, which already leaves IR out of
  capacity). Before this, every capacity check counted the IR player
  anyway, so stashing someone on IR never actually opened a spot.

- A player stays in the IR slot after their injury_status changes —
  eligibility (roster_slots.IR_ELIGIBLE_INJURY_STATUSES) is only checked
  when they're moved in. So once an IR player is no longer IR-eligible
  (e.g. "Out" -> "Doubtful"), the team is blocked from adding players
  (free agent, waiver claim, trade) until they move that player off IR
  or let them go in the same transaction — otherwise IR becomes a free
  extra roster spot for a healthy player.
"""
from app.domain.roster_slots import IR_ELIGIBLE_INJURY_STATUSES, IR_SLOT_LABEL


async def count_roster_toward_limit(conn, season: int, team_id: int) -> int:
    """Every rostered player except the ones in the IR slot."""
    return await conn.fetchval(
        "SELECT count(*) FROM current_rosters WHERE season = $1 AND team_id = $2 AND lineup_slot <> $3",
        season, team_id, IR_SLOT_LABEL,
    )


async def ineligible_ir_player_names(
    conn, season: int, team_id: int, leaving_sleeper_player_ids: list[str] | tuple[str, ...] = (),
) -> list[str]:
    """Players sitting in this team's IR slot whose current injury_status
    no longer qualifies for IR — skipping any the same transaction is
    already sending away (a drop target or a traded-away player), since
    that resolves the violation on its own."""
    rows = await conn.fetch(
        """
        SELECT cr.sleeper_player_id, p.full_name, p.injury_status
        FROM current_rosters cr JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
        WHERE cr.season = $1 AND cr.team_id = $2 AND cr.lineup_slot = $3
        """,
        season, team_id, IR_SLOT_LABEL,
    )
    leaving = set(leaving_sleeper_player_ids)
    return [
        r["full_name"]
        for r in rows
        if r["sleeper_player_id"] not in leaving
        and (r["injury_status"] or "").strip().upper() not in IR_ELIGIBLE_INJURY_STATUSES
    ]


def ir_violation_message(names: list[str]) -> str:
    who = ", ".join(names)
    return f"{who} is no longer eligible for IR — move them off IR before adding a player"
