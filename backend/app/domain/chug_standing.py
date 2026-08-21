"""
Jeffrey's Rule, the real version — a running per-owner chug balance
(chug_standing) that's separate from the historical, immutable weekly
record in chug_debts:

- Each week's auto-computed base debt (chug_debts.chugs_owed, from real
  roster performance — app/domain/chug_debt.py, unchanged) gets folded
  into the owner's running outstanding_owed via accrue_weekly_debt,
  idempotently (chug_debt_accruals tracks what's already been applied,
  so a stat correction later in the week is picked up as a delta, and
  re-running every sync never double-counts).
- Once Monday Night Football's real kickoff passes (app/domain/
  chug_deadline.py) and settle_deadline_for_week runs for that week
  (once — chug_deadline_settlements is both the idempotency marker and
  the audit trail): anyone with outstanding_owed > 0 has it doubled, up
  to MAX_CONSECUTIVE_DOUBLINGS consecutive misses. On the miss that
  hits the cap, the current outstanding balance converts entirely into
  fined_owed instead of doubling again — a real dollar amount
  (FINE_PER_CHUG each) that a real chug can no longer pay down. Only
  clear_fine (a commissioner-only action, see app/routers/chug.py) can
  reduce fined_owed, and only once the fine's actually been paid in
  real life — explicit product decision, not an oversight: a fined
  chug doesn't come back down just because someone drank one.
- record_completed_chug is the other side: called when a real,
  video-verified chug lands (POST /chug/upload). It only ever touches
  outstanding_owed, never fined_owed, and never goes below zero — an
  owner with outstanding_owed already at 0 who posts a chug anyway
  just gets it counted toward their lifetime total (chug_scores itself
  is that ledger — see app/domain/chug_leaderboard.py's
  lifetime_completed) with no effect on any balance. That's the
  explicit "for funsies" case: a real chug never goes to waste banking
  against a future week, but it also never gets refused.
"""
from datetime import datetime

from app.domain.chug_deadline import is_past_mnf_deadline

MAX_CONSECUTIVE_DOUBLINGS = 3
FINE_PER_CHUG = 10


async def accrue_weekly_debt(conn, season: int, week: int) -> int:
    rows = await conn.fetch(
        "SELECT owner_id, chugs_owed FROM chug_debts WHERE season = $1 AND week = $2", season, week
    )

    changed = 0
    for r in rows:
        owner_id, chugs_owed = r["owner_id"], r["chugs_owed"]
        applied = await conn.fetchval(
            "SELECT applied_amount FROM chug_debt_accruals WHERE season = $1 AND week = $2 AND owner_id = $3",
            season, week, owner_id,
        )
        applied = applied or 0
        delta = chugs_owed - applied
        if delta == 0:
            continue

        await conn.execute(
            """
            INSERT INTO chug_standing (season, owner_id, outstanding_owed)
            VALUES ($1, $2, GREATEST($3, 0))
            ON CONFLICT (season, owner_id) DO UPDATE SET
                outstanding_owed = GREATEST(chug_standing.outstanding_owed + $3, 0),
                updated_at = now()
            """,
            season, owner_id, delta,
        )
        await conn.execute(
            """
            INSERT INTO chug_debt_accruals (season, week, owner_id, applied_amount)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (season, week, owner_id) DO UPDATE SET applied_amount = EXCLUDED.applied_amount
            """,
            season, week, owner_id, chugs_owed,
        )
        changed += 1
    return changed


async def accrue_weekly_debt_for_season(pool, season: int) -> int:
    async with pool.acquire() as conn:
        weeks = await conn.fetch("SELECT DISTINCT week FROM chug_debts WHERE season = $1 ORDER BY week", season)
        total = 0
        for w in weeks:
            total += await accrue_weekly_debt(conn, season, w["week"])
    return total


async def accrue_weekly_debt_for_single_week(pool, season: int, week: int) -> int:
    async with pool.acquire() as conn:
        return await accrue_weekly_debt(conn, season, week)


async def settle_deadline_for_week(conn, season: int, week: int) -> int:
    owners = await conn.fetch("SELECT owner_id FROM chug_standing WHERE season = $1", season)

    settled = 0
    for o in owners:
        owner_id = o["owner_id"]
        already = await conn.fetchval(
            "SELECT 1 FROM chug_deadline_settlements WHERE season = $1 AND week = $2 AND owner_id = $3",
            season, week, owner_id,
        )
        if already:
            continue

        standing = await conn.fetchrow(
            "SELECT outstanding_owed, consecutive_missed_weeks FROM chug_standing WHERE season = $1 AND owner_id = $2",
            season, owner_id,
        )
        owed_before = standing["outstanding_owed"]

        if owed_before == 0:
            action = "no_debt"
            owed_after = 0
            await conn.execute(
                "UPDATE chug_standing SET consecutive_missed_weeks = 0, updated_at = now() "
                "WHERE season = $1 AND owner_id = $2",
                season, owner_id,
            )
        else:
            missed = standing["consecutive_missed_weeks"] + 1
            if missed >= MAX_CONSECUTIVE_DOUBLINGS:
                action = "fined"
                owed_after = 0
                await conn.execute(
                    """
                    UPDATE chug_standing SET
                        outstanding_owed = 0,
                        fined_owed = fined_owed + $3,
                        consecutive_missed_weeks = 0,
                        updated_at = now()
                    WHERE season = $1 AND owner_id = $2
                    """,
                    season, owner_id, owed_before,
                )
            else:
                action = "doubled"
                owed_after = owed_before * 2
                await conn.execute(
                    "UPDATE chug_standing SET outstanding_owed = $3, consecutive_missed_weeks = $4, updated_at = now() "
                    "WHERE season = $1 AND owner_id = $2",
                    season, owner_id, owed_after, missed,
                )

        await conn.execute(
            """
            INSERT INTO chug_deadline_settlements (season, week, owner_id, owed_before, action, owed_after)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            season, week, owner_id, owed_before, action, owed_after,
        )
        settled += 1
    return settled


async def ensure_chug_deadline_settled(
    pool, season: int, week: int, games: list[dict], now: datetime | None = None
) -> int:
    """Best-effort, idempotent — safe to call every sync tick. No-ops
    until the real MNF deadline for the current week has actually
    passed; once it has, accrues any last-minute debt first (so the
    doubling reflects final roster performance, not a stale snapshot)
    and then settles, exactly once. now is test-only — every real
    caller (app/providers/sync.py) leaves it as None (real wall-clock
    time)."""
    if not is_past_mnf_deadline(games, now):
        return 0
    async with pool.acquire() as conn:
        await accrue_weekly_debt(conn, season, week)
        return await settle_deadline_for_week(conn, season, week)


async def record_completed_chug(conn, season: int, owner_id: int) -> None:
    """A real, video-verified chug pays down outstanding_owed by one if
    any is owed; never touches fined_owed (only a commissioner clearing
    a paid fine does — see clear_fine); never goes below zero, and does
    nothing at all to the balance when nothing's owed — a "for funsies"
    chug still lands in chug_scores (lifetime_completed), just with no
    debt-side effect."""
    await conn.execute(
        "UPDATE chug_standing SET outstanding_owed = outstanding_owed - 1, updated_at = now() "
        "WHERE season = $1 AND owner_id = $2 AND outstanding_owed > 0",
        season, owner_id,
    )


async def clear_fine(conn, season: int, owner_id: int, amount: int | None = None) -> int:
    """Commissioner-only (enforced at the router level) — marks a real-
    life fine payment by reducing fined_owed. amount=None clears it
    entirely; otherwise clears exactly that many (clamped so it can
    never go negative or clear more than was actually owed). Returns
    the amount actually cleared."""
    row = await conn.fetchrow(
        "SELECT fined_owed FROM chug_standing WHERE season = $1 AND owner_id = $2", season, owner_id
    )
    if not row or row["fined_owed"] == 0:
        return 0

    to_clear = row["fined_owed"] if amount is None else min(amount, row["fined_owed"])
    if to_clear <= 0:
        return 0

    await conn.execute(
        "UPDATE chug_standing SET fined_owed = fined_owed - $3, updated_at = now() "
        "WHERE season = $1 AND owner_id = $2",
        season, owner_id, to_clear,
    )
    return to_clear
