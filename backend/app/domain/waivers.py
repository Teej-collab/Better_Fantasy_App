"""
Real waiver-wire system — ESPN's own documented "Standard Waivers"
rules: priority-order waivers (not FAAB, worst record picks first),
and waiver order that resets each week to the inverse of standings.
Closes the competitive audit's #1 confirmed functional gap: free-agent
pickups were instant/first-come-first-served with zero waiver
enforcement.

2026-09-22 correction (real report, quoting ESPN's own rules text):
"Waivers process daily between 3 a.m. and 5 a.m. ET, with the main
weekly run happening Tuesday night into Wednesday morning" — every
player locked/dropped at any point during the week (Thursday's game
through Monday Night Football) clears at that SAME Wednesday-morning
instant, not some rolling offset from when they individually hit the
wire (a prior version of this file modeled it as a flat `timedelta(
days=1)` from the drop, which let a player dropped early in the week
clear mid-week — well before the real Wednesday run, letting them be
scooped up with no claim required). Modeled here as next Wednesday
3:00 AM ET, the start of ESPN's own stated processing window — see
`_next_wednesday_clear_et` below. 2026-09-23: that Wednesday clear
applies to game-locked free agents only; a player a team actually drops
is back on this league's real 1-day waiver period (DROP_WAIVER_PERIOD). Also per that same source: "Game
Lock: individual players lock at the start of their team's scheduled
game and move to waiver status" — exactly what waivers.ensure_waiver_
clock_if_game_locked (below) already does, and "Same-Day Add/Drop: ...
does not go back on waivers" — not yet implemented, since this app has
no same-day add+drop path today.

Three tables (migrations/versions/8b295d67654f_*):

- waiver_wire: a player is "on waivers" right now iff a row exists here
  with clears_at in the future. start_waiver_clock writes one whenever
  a player is dropped (called from every drop/displacement path — see
  app/routers/me.py and app/routers/commissioner_lineup.py). The daily
  scheduler job (app/scheduler.py's _run_waiver_processing_job) deletes
  a player's row once its clears_at has passed, after resolving any
  pending claims for them — the delete itself is the idempotency
  marker, so "no row" and "already-processed" read the same way.

- waiver_claims: a team's bid on a currently-waived player. One
  pending claim per (team, player) at a time (waiver_claims_one_
  pending_per_team_player). Resolves to 'successful'/'failed' when
  that player's waiver_wire row is processed, or 'cancelled' if the
  team pulls it back first.

- team_waiver_priority: this league's real "resets each week to
  inverse order of standings" rule, materialized the first time a
  given (season, league_id, week) is touched — worst record first
  (see app/queries/league.py's get_standings, reversed). A team that
  WINS a claim is bumped to the back of the CURRENT week's list
  immediately, matching every real platform's own priority-waiver
  behavior — this is what stops one team sweeping every contested
  player claim in a single week.

Deliberately does NOT implement FAAB, a season acquisition limit (this
league's real setting is "No Limit"), or locking transactions for
eliminated teams (this league's real setting is "No" — and this app
has no playoff-elimination concept yet anyway, see the competitive
audit's schedule/playoff finding).
"""
import json
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.domain.lineup_exceptions import PlayerNotOnRosterError
from app.domain.nfl_schedule import locked_pro_teams
from app.domain.roster_slots import BENCH_SLOT_LABEL, total_draftable_slots
from app.domain.waiver_exceptions import (
    ClaimNotCancellableError,
    ClaimNotFoundError,
    DuplicateClaimError,
    PlayerNotOnWaiversError,
)
from app.queries.league import get_standings
from app.queries.roster_transactions import log_transaction

# ESPN's own real "Standard Waivers" setting — not yet commissioner-
# configurable in-app (see the competitive audit's Section 33 P2 list
# for "settings become real, not just displayed").
_ET = ZoneInfo("America/New_York")
_WAIVER_CLEAR_TIME_ET = time(3, 0)  # 3:00 AM ET — start of ESPN's stated 3-5am processing window
_WAIVER_CLEAR_WEEKDAY = 2  # Mon=0 ... Wed=2
# A player a team actually drops is on waivers for 1 day — this league's
# real ESPN setting (commissioner's screenshot, 2026-09). Only
# game-locked, never-dropped free agents wait for the Wednesday clear.
# 2026-09-23: the 2026-09-22 change had applied the Wednesday clear to
# drops too, stranding a player dropped Wednesday morning for a week.
DROP_WAIVER_PERIOD = timedelta(days=1)


def _next_wednesday_clear_et(now: datetime) -> datetime:
    """The next real waiver-clear instant strictly after `now` — 3:00
    AM ET on the nearest upcoming Wednesday (ESPN's own "main weekly
    run"), or a full 7 days out if `now` is already sitting at (or
    past) this week's own Wednesday-3am mark. Every player waived at
    any point during the week clears at this SAME instant, not some
    fixed offset from when they individually hit the wire."""
    now_et = now.astimezone(_ET)
    days_until = (_WAIVER_CLEAR_WEEKDAY - now_et.weekday()) % 7
    candidate = datetime.combine(now_et.date(), _WAIVER_CLEAR_TIME_ET, tzinfo=_ET) + timedelta(days=days_until)
    if candidate <= now_et:
        candidate += timedelta(days=7)
    return candidate.astimezone(timezone.utc)


def waiver_locked_pro_teams(
    current_week_games: list[dict], prior_week_games: list[dict] | None, now: datetime | None = None,
) -> frozenset[str]:
    """Every real NFL team whose free agents currently need a waiver
    claim instead of an instant add — NOT the same set as the lineup
    lock. The current week's kicked-off teams always count. Right after
    the week rolls over (current week hasn't kicked off yet), the week
    that just ended still counts too, but ONLY until the Wednesday-3am-ET
    clear that follows its last kickoff — the same instant a real drop
    during that week clears (`_next_wednesday_clear_et`).

    2026-09-23 real report: the 2026-09-22 rollover fallback had no
    such end, and was also fed into the lineup lock — so all Wednesday
    every week-2 team counted as "game already started" (nobody could
    move a single player for week 3) and every free agent stayed a
    claim well past the Wednesday clear, with each add attempt starting
    a fresh clock out to the FOLLOWING Wednesday."""
    now = now or datetime.now(timezone.utc)
    locked = locked_pro_teams(current_week_games, now)
    if locked or not prior_week_games:
        return locked
    prior_locked = locked_pro_teams(prior_week_games, now)
    kickoffs = []
    for game in prior_week_games:
        try:
            kickoffs.append(datetime.fromisoformat(game["date"].replace("Z", "+00:00")))
        except (KeyError, AttributeError, ValueError):
            continue
    if not prior_locked or not kickoffs:
        return locked
    if now >= _next_wednesday_clear_et(max(kickoffs)):
        return locked
    return prior_locked


async def start_waiver_clock(
    conn, season: int, league_id: int, sleeper_player_id: str, clears_at: datetime | None = None,
) -> None:
    """Called whenever a player becomes a free agent via a real drop
    (app/domain/lineup_engine.py's drop_player, or the displaced player
    in add_free_agent's own drop-to-make-room branch) — upsert rather
    than insert, since the same player can cycle on/off waivers
    multiple times in a season. A real drop defaults to this league's
    DROP_WAIVER_PERIOD; ensure_waiver_clock_if_game_locked passes the
    Wednesday-3am-ET clear instead."""
    if clears_at is None:
        clears_at = datetime.now(timezone.utc) + DROP_WAIVER_PERIOD
    await conn.execute(
        """
        INSERT INTO waiver_wire (season, league_id, sleeper_player_id, waived_at, clears_at)
        VALUES ($1, $2, $3, now(), $4)
        ON CONFLICT (season, league_id, sleeper_player_id)
        DO UPDATE SET waived_at = now(), clears_at = EXCLUDED.clears_at
        """,
        season, league_id, sleeper_player_id, clears_at,
    )


async def is_on_waivers(conn, season: int, league_id: int, sleeper_player_id: str) -> bool:
    row = await conn.fetchval(
        "SELECT 1 FROM waiver_wire WHERE season = $1 AND league_id = $2 AND sleeper_player_id = $3 AND clears_at > now()",
        season, league_id, sleeper_player_id,
    )
    return row is not None


async def get_waiver_clears_at(conn, season: int, league_id: int, sleeper_player_ids: list[str]) -> dict[str, datetime]:
    """Bulk lookup for the free-agent browse list — sleeper_player_id ->
    clears_at, only for players currently on waivers (already-past rows
    are as good as deleted for this purpose, even if the sweep job
    hasn't gotten to them yet)."""
    if not sleeper_player_ids:
        return {}
    rows = await conn.fetch(
        """
        SELECT sleeper_player_id, clears_at FROM waiver_wire
        WHERE season = $1 AND league_id = $2 AND sleeper_player_id = ANY($3::text[]) AND clears_at > now()
        """,
        season, league_id, sleeper_player_ids,
    )
    return {r["sleeper_player_id"]: r["clears_at"] for r in rows}


async def ensure_waiver_clock_if_game_locked(
    conn, season: int, league_id: int, sleeper_player_id: str, locked_pro_teams: frozenset[str],
) -> None:
    """Real ask, 2026-09-13: once a free agent's real NFL game for this
    week has kicked off, they should require a waiver claim like anyone
    else on waivers — not stay instantly addable just because they
    were never actually dropped by a team. `locked_pro_teams` (see
    app/domain/nfl_schedule.py — every real NFL team whose game has
    already kicked off this week) is the same signal the lineup lock
    already uses; this reuses it for a second purpose rather than
    inventing a parallel "is this player's game locked" concept.

    Lazily starts this player's REAL waiver clock (the exact same
    mechanism a genuine drop uses) the first time anyone actually tries
    to touch them — an add attempt (app/routers/me.py's free-agent-add
    and app/routers/commissioner_lineup.py's force-add) or a direct
    claim submission (waivers/claim) — rather than a separate scheduler
    job proactively locking every newly-kicked-off team's whole free-
    agent pool every tick. That keeps this entirely inside the existing
    waiver_wire/waiver_claims/process_expired_waivers machinery with no
    new concepts: once this call has run once for a player, `is_on_
    waivers`/`submit_claim`/the daily sweep all already treat them
    exactly like a normal drop, unmodified. A no-op once a row already
    exists (checked via is_on_waivers, not blindly re-calling
    start_waiver_clock — that upsert resets clears_at, which would
    keep pushing this player's own waiver period further out every
    time someone merely LOOKS at them, never actually letting it
    clear)."""
    if not locked_pro_teams:
        return
    pro_team = await conn.fetchval("SELECT pro_team FROM players WHERE sleeper_player_id = $1", sleeper_player_id)
    if pro_team not in locked_pro_teams:
        return
    if await is_on_waivers(conn, season, league_id, sleeper_player_id):
        return
    await start_waiver_clock(
        conn, season, league_id, sleeper_player_id,
        clears_at=_next_wednesday_clear_et(datetime.now(timezone.utc)),
    )


async def force_clear_waiver(conn, season: int, league_id: int, sleeper_player_id: str, reason: str) -> None:
    """Commissioner override (app/routers/commissioner_lineup.py) placed
    this player directly onto a roster, bypassing the normal waiver
    period entirely — called right after that write succeeds, in the
    same transaction, to fail every pending claim on them and remove
    the waiver_wire row itself. Without this, the daily scheduler job
    (process_expired_waivers, below) would still try to award the SAME
    player to whichever claim had the best priority once clears_at
    passed, fighting the commissioner's own override and — since
    current_rosters has no defense against a player ending up rostered
    twice — actually able to duplicate them onto a second team."""
    await conn.execute(
        "UPDATE waiver_claims SET status = 'failed', failure_reason = $1, processed_at = now() "
        "WHERE season = $2 AND league_id = $3 AND add_sleeper_player_id = $4 AND status = 'pending'",
        reason, season, league_id, sleeper_player_id,
    )
    await conn.execute(
        "DELETE FROM waiver_wire WHERE season = $1 AND league_id = $2 AND sleeper_player_id = $3",
        season, league_id, sleeper_player_id,
    )


async def submit_claim(
    conn, season: int, league_id: int, team_id: int, add_sleeper_player_id: str,
    drop_sleeper_player_id: str | None = None,
) -> dict:
    if not await is_on_waivers(conn, season, league_id, add_sleeper_player_id):
        raise PlayerNotOnWaiversError(
            f"{add_sleeper_player_id} isn't on waivers right now — add them directly instead of filing a claim"
        )
    existing = await conn.fetchval(
        """
        SELECT 1 FROM waiver_claims
        WHERE season = $1 AND league_id = $2 AND team_id = $3 AND add_sleeper_player_id = $4 AND status = 'pending'
        """,
        season, league_id, team_id, add_sleeper_player_id,
    )
    if existing:
        raise DuplicateClaimError(f"You already have a pending claim on {add_sleeper_player_id}")
    if drop_sleeper_player_id is not None:
        on_roster = await conn.fetchval(
            "SELECT 1 FROM current_rosters WHERE season = $1 AND league_id = $2 AND team_id = $3 AND sleeper_player_id = $4",
            season, league_id, team_id, drop_sleeper_player_id,
        )
        if not on_roster:
            raise PlayerNotOnRosterError(f"{drop_sleeper_player_id} isn't on your roster")
    row = await conn.fetchrow(
        """
        INSERT INTO waiver_claims (season, league_id, team_id, add_sleeper_player_id, drop_sleeper_player_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, season, league_id, team_id, add_sleeper_player_id, drop_sleeper_player_id,
                  status, failure_reason, created_at, processed_at
        """,
        season, league_id, team_id, add_sleeper_player_id, drop_sleeper_player_id,
    )
    return dict(row)


async def list_claims_for_team(conn, season: int, league_id: int, team_id: int) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT wc.id, wc.add_sleeper_player_id, ap.full_name AS add_player_name,
               wc.drop_sleeper_player_id, dp.full_name AS drop_player_name,
               wc.status, wc.failure_reason, wc.created_at, wc.processed_at
        FROM waiver_claims wc
        JOIN players ap ON ap.sleeper_player_id = wc.add_sleeper_player_id
        LEFT JOIN players dp ON dp.sleeper_player_id = wc.drop_sleeper_player_id
        WHERE wc.season = $1 AND wc.league_id = $2 AND wc.team_id = $3
        ORDER BY wc.created_at DESC
        """,
        season, league_id, team_id,
    )
    return [dict(r) for r in rows]


async def cancel_claim(conn, season: int, league_id: int, team_id: int, claim_id: int) -> None:
    row = await conn.fetchrow(
        "SELECT status FROM waiver_claims WHERE id = $1 AND season = $2 AND league_id = $3 AND team_id = $4",
        claim_id, season, league_id, team_id,
    )
    if row is None:
        raise ClaimNotFoundError(f"No claim {claim_id} found for this team")
    if row["status"] != "pending":
        raise ClaimNotCancellableError(f"Claim {claim_id} is already {row['status']} — nothing to cancel")
    await conn.execute("UPDATE waiver_claims SET status = 'cancelled', processed_at = now() WHERE id = $1", claim_id)


async def _seed_priority_for_week(conn, season: int, league_id: int, week: int) -> None:
    """Worst record first (this league's real "inverse order of
    standings" rule) — get_standings is already sorted best-first
    (wins DESC, points_for DESC), so priority 1 goes to the LAST row."""
    standings = await get_standings(conn, season, league_id)
    worst_first = list(reversed(standings))
    for priority, row in enumerate(worst_first, start=1):
        await conn.execute(
            """
            INSERT INTO team_waiver_priority (season, league_id, week, team_id, priority)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (season, league_id, week, team_id) DO NOTHING
            """,
            season, league_id, week, row["team_id"], priority,
        )


async def get_priority_order(conn, season: int, league_id: int, week: int) -> list[dict]:
    """This week's real waiver order, seeding it from current standings
    the first time this week is ever touched. Returns team_id ->
    priority rows, priority 1 first (claims that player first)."""
    exists = await conn.fetchval(
        "SELECT 1 FROM team_waiver_priority WHERE season = $1 AND league_id = $2 AND week = $3 LIMIT 1",
        season, league_id, week,
    )
    if not exists:
        await _seed_priority_for_week(conn, season, league_id, week)
    rows = await conn.fetch(
        """
        SELECT twp.team_id, t.team_name, twp.priority
        FROM team_waiver_priority twp
        JOIN teams_by_season t ON t.id = twp.team_id
        WHERE twp.season = $1 AND twp.league_id = $2 AND twp.week = $3
        ORDER BY twp.priority ASC
        """,
        season, league_id, week,
    )
    return [dict(r) for r in rows]


async def _bump_to_back(conn, season: int, league_id: int, week: int, team_id: int) -> None:
    max_priority = await conn.fetchval(
        "SELECT MAX(priority) FROM team_waiver_priority WHERE season = $1 AND league_id = $2 AND week = $3",
        season, league_id, week,
    )
    await conn.execute(
        """
        UPDATE team_waiver_priority SET priority = $1
        WHERE season = $2 AND league_id = $3 AND week = $4 AND team_id = $5
        """,
        (max_priority or 0) + 1, season, league_id, week, team_id,
    )


async def _roster_has_room(conn, season: int, league_id: int, team_id: int) -> bool:
    roster_slots_raw = await conn.fetchval(
        "SELECT roster_slots FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
    )
    if roster_slots_raw is None:
        return False
    roster_slots = json.loads(roster_slots_raw) if isinstance(roster_slots_raw, str) else roster_slots_raw
    capacity = total_draftable_slots(roster_slots)
    current_count = await conn.fetchval(
        "SELECT count(*) FROM current_rosters WHERE season = $1 AND team_id = $2", season, team_id
    )
    return current_count < capacity


async def _resolve_one_player(conn, season: int, league_id: int, week: int, sleeper_player_id: str) -> dict:
    """Walks this player's pending claims in this week's priority order,
    executing the first one that still validates (roster room or a
    still-real drop target) and failing every other claim on this
    player — either the winner's remaining claims for OTHER players (a
    separate row each, untouched here) or every other team's claim on
    THIS player, which all fail together the moment one claim wins.
    Deletes the waiver_wire row unconditionally at the end: whether a
    claim won, every claim failed validation, or there were no claims
    at all, this player's waiver period is over either way."""
    claims = await conn.fetch(
        """
        SELECT wc.id, wc.team_id, wc.drop_sleeper_player_id
        FROM waiver_claims wc
        JOIN team_waiver_priority twp
            ON twp.season = wc.season AND twp.league_id = wc.league_id
           AND twp.week = $4 AND twp.team_id = wc.team_id
        WHERE wc.season = $1 AND wc.league_id = $2 AND wc.add_sleeper_player_id = $3 AND wc.status = 'pending'
        ORDER BY twp.priority ASC
        """,
        season, league_id, sleeper_player_id, week,
    )

    winner_claim_id = None
    outcomes = []
    for claim in claims:
        if winner_claim_id is not None:
            await conn.execute(
                "UPDATE waiver_claims SET status = 'failed', failure_reason = $1, processed_at = now() WHERE id = $2",
                "Lost the waiver — a higher-priority claim won this player", claim["id"],
            )
            outcomes.append({"claim_id": claim["id"], "status": "failed"})
            continue

        dropped_player_id = claim["drop_sleeper_player_id"]
        if dropped_player_id is not None:
            still_on_roster = await conn.fetchval(
                "SELECT 1 FROM current_rosters WHERE season = $1 AND league_id = $2 AND team_id = $3 AND sleeper_player_id = $4",
                season, league_id, claim["team_id"], dropped_player_id,
            )
            if not still_on_roster:
                await conn.execute(
                    "UPDATE waiver_claims SET status = 'failed', failure_reason = $1, processed_at = now() WHERE id = $2",
                    "Your drop target is no longer on your roster", claim["id"],
                )
                outcomes.append({"claim_id": claim["id"], "status": "failed"})
                continue
        elif not await _roster_has_room(conn, season, league_id, claim["team_id"]):
            await conn.execute(
                "UPDATE waiver_claims SET status = 'failed', failure_reason = $1, processed_at = now() WHERE id = $2",
                "Your roster was full with no drop specified", claim["id"],
            )
            outcomes.append({"claim_id": claim["id"], "status": "failed"})
            continue

        if dropped_player_id is not None:
            await conn.execute(
                "DELETE FROM current_rosters WHERE season = $1 AND league_id = $2 AND team_id = $3 AND sleeper_player_id = $4",
                season, league_id, claim["team_id"], dropped_player_id,
            )
            await start_waiver_clock(conn, season, league_id, dropped_player_id)
        await conn.execute(
            """
            INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id)
            VALUES ($1, $2, $3, $4, 'waiver', $5)
            """,
            season, claim["team_id"], sleeper_player_id, BENCH_SLOT_LABEL, league_id,
        )
        await conn.execute(
            "UPDATE waiver_claims SET status = 'successful', processed_at = now() WHERE id = $1", claim["id"],
        )
        await log_transaction(
            conn, season, claim["team_id"], source="waiver",
            added_sleeper_player_id=sleeper_player_id,
            dropped_sleeper_player_id=dropped_player_id,
            league_id=league_id,
        )
        await _bump_to_back(conn, season, league_id, week, claim["team_id"])
        winner_claim_id = claim["id"]
        outcomes.append({"claim_id": claim["id"], "status": "successful"})

    await conn.execute(
        "DELETE FROM waiver_wire WHERE season = $1 AND league_id = $2 AND sleeper_player_id = $3",
        season, league_id, sleeper_player_id,
    )
    return {"sleeper_player_id": sleeper_player_id, "outcomes": outcomes}


async def process_expired_waivers(conn, season: int, league_id: int, week: int) -> list[dict]:
    """The daily scheduler job's actual work for one league: every
    player whose 1-day waiver clock has already run out gets resolved
    — highest-priority pending claim wins (if any), everyone else on
    that player fails, and the player leaves the waiver wire either
    way. Each player is resolved inside its own transaction so one
    player's edge case (e.g. a stale drop target) can't roll back an
    otherwise-clean run for every other expired player this tick."""
    expired = await conn.fetch(
        "SELECT sleeper_player_id FROM waiver_wire WHERE season = $1 AND league_id = $2 AND clears_at <= now()",
        season, league_id,
    )
    if not expired:
        return []
    # Must run before _resolve_one_player's own claims query, which
    # INNER JOINs against team_waiver_priority — if this week has never
    # been touched yet, that join would silently match zero rows for
    # every claim (not seed itself), treating a real contested player
    # as if nobody had claimed them at all.
    await get_priority_order(conn, season, league_id, week)
    results = []
    for row in expired:
        async with conn.transaction():
            results.append(await _resolve_one_player(conn, season, league_id, week, row["sleeper_player_id"]))
    return results
