"""
Turn engine for the in-app real-time draft (project plan Phase B) —
snake-order generation, transaction-safe pick submission, autopick,
and undo. Called from app/routers/draft.py (owner-facing pick
submission, commissioner setup/start/pause/resume/undo) and from
app/scheduler.py's draft-clock job (autopick on timeout).

All picks for the whole draft are pre-generated at setup time via
plan_snake_order() rather than inserted one at a time — the board is
fully knowable before a single live pick happens. A team's pre-selected
keeper (see seed_keeper_pick) occupies one round's pick row before the
draft starts, with sleeper_player_id already filled and made_at already
set — make_pick's turn-advancement loop (_advance_to_next_open_pick)
skips any pick_number that already has a player, which is what makes a
keeper's round a no-op for the live draft without any special-casing at
pick-submission time.
"""
import json
from datetime import datetime, timedelta, timezone

from app.domain.draft_autopick import choose_autopick
from app.domain.draft_exceptions import (
    DraftAlreadyExistsError,
    DraftNotFoundError,
    DraftNotInProgressError,
    NothingToUndoError,
    NotYourTurnError,
    PlayerAlreadyDraftedError,
    PlayerNotDraftableError,
)

_STARTER_SLOTS = ("QB", "RB", "WR", "TE", "RB/WR/TE", "D/ST", "K")


def _config_dict(row) -> dict:
    """asyncpg doesn't auto-decode JSONB — roster_slots comes back as a
    raw JSON string from any query that doesn't explicitly parse it, so
    every draft_config row this module hands back (return value or
    internal use like choose_autopick's roster_slots argument) goes
    through here first."""
    d = dict(row)
    if isinstance(d.get("roster_slots"), str):
        d["roster_slots"] = json.loads(d["roster_slots"])
    return d


def plan_snake_order(draft_order: list[int], rounds: int) -> list[tuple[int, int, int, int]]:
    """Returns (pick_number, round, round_pick, owner_id) for every pick
    in the draft. Odd rounds use draft_order as-is; even rounds use it
    reversed — the standard snake-draft shape. Pure, no DB."""
    n = len(draft_order)
    picks = []
    pick_number = 1
    for round_num in range(1, rounds + 1):
        order = draft_order if round_num % 2 == 1 else list(reversed(draft_order))
        for round_pick, owner_id in enumerate(order, start=1):
            picks.append((pick_number, round_num, round_pick, owner_id))
            pick_number += 1
    return picks


def total_draftable_slots(roster_slots: dict[str, int]) -> int:
    """Bench + every starter slot, excluding IR — IR is never filled by
    the initial draft (this league's real rule, confirmed by the
    owner's ESPN scoring screenshots: IR is filled later via waivers)."""
    return sum(roster_slots.get(s, 0) for s in _STARTER_SLOTS) + roster_slots.get("BE", 0)


async def create_draft(
    conn, season: int, draft_order: list[int], roster_slots: dict, pick_time_limit_seconds: int = 90
) -> None:
    """Refuses to overwrite an existing draft_config for this season —
    call reset_draft() first if you need to change the order or roster
    shape (e.g. after a mock draft, or the commissioner changing their
    mind before the real one). This is deliberately a hard stop, not a
    silent overwrite: draft_picks/current_rosters rows from a real
    draft are exactly the kind of data a silent re-setup could quietly
    destroy."""
    async with conn.transaction():
        exists = await conn.fetchval("SELECT 1 FROM draft_config WHERE season = $1", season)
        if exists:
            raise DraftAlreadyExistsError(
                f"A draft already exists for season {season} — reset it first if you want to change the order"
            )
        rounds = total_draftable_slots(roster_slots)
        await conn.execute(
            """
            INSERT INTO draft_config (season, pick_time_limit_seconds, draft_order, roster_slots)
            VALUES ($1, $2, $3, $4)
            """,
            season, pick_time_limit_seconds, draft_order, json.dumps(roster_slots),
        )
        rows = plan_snake_order(draft_order, rounds)
        await conn.executemany(
            """
            INSERT INTO draft_picks (season, pick_number, round, round_pick, owner_id)
            VALUES ($1, $2, $3, $4, $5)
            """,
            [(season, pick_number, round_num, round_pick, owner_id) for pick_number, round_num, round_pick, owner_id in rows],
        )


async def seed_keeper_pick(conn, season: int, owner_id: int, round_num: int, sleeper_player_id: str) -> None:
    """Pre-fills this owner's pick in `round_num` with their keeper —
    must run after create_draft (the pick rows must already exist) and
    before start_draft. Also seeds current_rosters, same as a live pick
    does, so a keeper shows up on the team's roster immediately."""
    async with conn.transaction():
        pick = await conn.fetchrow(
            "SELECT pick_number FROM draft_picks WHERE season = $1 AND round = $2 AND owner_id = $3",
            season, round_num, owner_id,
        )
        if pick is None:
            raise DraftNotFoundError(f"No pick found for owner {owner_id} in round {round_num}")
        await conn.execute(
            """
            UPDATE draft_picks SET sleeper_player_id = $1, is_keeper = TRUE, made_at = now()
            WHERE season = $2 AND pick_number = $3
            """,
            sleeper_player_id, season, pick["pick_number"],
        )
        team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2", season, owner_id
        )
        await conn.execute(
            """
            INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via)
            VALUES ($1, $2, $3, 'BE', 'keeper')
            """,
            season, team_id, sleeper_player_id,
        )


async def _advance_to_next_open_pick(conn, season: int, from_pick_number: int, pick_time_limit_seconds: int) -> dict:
    """Walks forward from from_pick_number, skipping any pick that
    already has a player (a pre-filled keeper pick — see module
    docstring), and sets draft_config to either the next open pick
    (with a fresh deadline) or 'complete' if none remain. Returns the
    updated draft_config row."""
    pick_number = from_pick_number
    while True:
        pick = await conn.fetchrow(
            "SELECT * FROM draft_picks WHERE season = $1 AND pick_number = $2", season, pick_number
        )
        if pick is None:
            return _config_dict(await conn.fetchrow(
                """
                UPDATE draft_config
                SET status = 'complete', completed_at = now(), current_pick_deadline = NULL,
                    current_pick_number = $1
                WHERE season = $2 RETURNING *
                """,
                pick_number, season,
            ))
        if pick["sleeper_player_id"] is None:
            deadline = datetime.now(timezone.utc) + timedelta(seconds=pick_time_limit_seconds)
            return _config_dict(await conn.fetchrow(
                """
                UPDATE draft_config SET current_pick_number = $1, current_pick_deadline = $2
                WHERE season = $3 RETURNING *
                """,
                pick_number, deadline, season,
            ))
        pick_number += 1


async def start_draft(conn, season: int) -> dict:
    async with conn.transaction():
        config = await conn.fetchrow("SELECT * FROM draft_config WHERE season = $1 FOR UPDATE", season)
        if config is None:
            raise DraftNotFoundError(f"No draft configured for season {season}")
        await conn.execute(
            "UPDATE draft_config SET status = 'in_progress', started_at = now() WHERE season = $1", season
        )
        return await _advance_to_next_open_pick(conn, season, 1, config["pick_time_limit_seconds"])


async def pause_draft(conn, season: int) -> dict:
    async with conn.transaction():
        config = await conn.fetchrow("SELECT * FROM draft_config WHERE season = $1 FOR UPDATE", season)
        if config is None or config["status"] != "in_progress":
            raise DraftNotInProgressError(f"Draft for season {season} isn't in progress")
        remaining = None
        if config["current_pick_deadline"] is not None:
            remaining = max(0, int((config["current_pick_deadline"] - datetime.now(timezone.utc)).total_seconds()))
        return _config_dict(await conn.fetchrow(
            """
            UPDATE draft_config SET status = 'paused', paused_remaining_seconds = $1, current_pick_deadline = NULL
            WHERE season = $2 RETURNING *
            """,
            remaining, season,
        ))


async def resume_draft(conn, season: int) -> dict:
    async with conn.transaction():
        config = await conn.fetchrow("SELECT * FROM draft_config WHERE season = $1 FOR UPDATE", season)
        if config is None or config["status"] != "paused":
            raise DraftNotInProgressError(f"Draft for season {season} isn't paused")
        remaining = config["paused_remaining_seconds"] or config["pick_time_limit_seconds"]
        deadline = datetime.now(timezone.utc) + timedelta(seconds=remaining)
        return _config_dict(await conn.fetchrow(
            """
            UPDATE draft_config SET status = 'in_progress', current_pick_deadline = $1, paused_remaining_seconds = NULL
            WHERE season = $2 RETURNING *
            """,
            deadline, season,
        ))


async def make_pick(conn, season: int, owner_id: int, sleeper_player_id: str, is_autopick: bool = False) -> dict:
    async with conn.transaction():
        config = await conn.fetchrow("SELECT * FROM draft_config WHERE season = $1 FOR UPDATE", season)
        if config is None:
            raise DraftNotFoundError(f"No draft configured for season {season}")
        if config["status"] != "in_progress":
            raise DraftNotInProgressError(f"Draft for season {season} isn't in progress (status={config['status']})")

        pick = await conn.fetchrow(
            "SELECT * FROM draft_picks WHERE season = $1 AND pick_number = $2",
            season, config["current_pick_number"],
        )
        if pick is None or pick["owner_id"] != owner_id:
            raise NotYourTurnError("It isn't your turn to pick")

        player = await conn.fetchrow(
            "SELECT sleeper_player_id, is_draftable FROM players WHERE sleeper_player_id = $1", sleeper_player_id
        )
        if player is None or not player["is_draftable"]:
            raise PlayerNotDraftableError(f"{sleeper_player_id} isn't a draftable player")

        already_drafted = await conn.fetchval(
            "SELECT 1 FROM draft_picks WHERE season = $1 AND sleeper_player_id = $2",
            season, sleeper_player_id,
        )
        if already_drafted:
            raise PlayerAlreadyDraftedError(f"{sleeper_player_id} has already been drafted this season")

        await conn.execute(
            "UPDATE draft_picks SET sleeper_player_id = $1, is_autopick = $2, made_at = now() "
            "WHERE season = $3 AND pick_number = $4",
            sleeper_player_id, is_autopick, season, pick["pick_number"],
        )
        team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2", season, owner_id
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via) "
            "VALUES ($1, $2, $3, 'BE', 'draft')",
            season, team_id, sleeper_player_id,
        )
        new_config = await _advance_to_next_open_pick(
            conn, season, pick["pick_number"] + 1, config["pick_time_limit_seconds"]
        )
        made_pick = await conn.fetchrow(
            "SELECT * FROM draft_picks WHERE season = $1 AND pick_number = $2", season, pick["pick_number"]
        )
        return {"pick": dict(made_pick), "config": new_config}


async def autopick(conn, season: int) -> dict:
    """Called by the draft-clock scheduler job when a team's deadline
    passes with no pick made. Picks on that team's behalf using
    app/domain/draft_autopick.py's algorithm, then delegates to
    make_pick for the actual write (same validation, same
    turn-advancement)."""
    async with conn.transaction():
        config = _config_dict(await conn.fetchrow("SELECT * FROM draft_config WHERE season = $1", season) or {})
        if not config or config["status"] != "in_progress":
            raise DraftNotInProgressError(f"Draft for season {season} isn't in progress")
        pick = await conn.fetchrow(
            "SELECT * FROM draft_picks WHERE season = $1 AND pick_number = $2",
            season, config["current_pick_number"],
        )
        if pick is None:
            raise DraftNotFoundError("No current pick to autopick for")
        owner_id = pick["owner_id"]

        team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2", season, owner_id
        )
        rostered = await conn.fetch(
            "SELECT p.position FROM current_rosters cr JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id "
            "WHERE cr.season = $1 AND cr.team_id = $2",
            season, team_id,
        )
        rostered_positions = [r["position"] for r in rostered]

        available = await conn.fetch(
            """
            SELECT p.sleeper_player_id, p.position, p.search_rank FROM players p
            WHERE p.is_draftable AND p.sleeper_player_id NOT IN (
                SELECT sleeper_player_id FROM draft_picks WHERE season = $1 AND sleeper_player_id IS NOT NULL
            )
            ORDER BY p.search_rank ASC NULLS LAST
            """,
            season,
        )
        chosen = choose_autopick(rostered_positions, config["roster_slots"], [dict(r) for r in available])
        if chosen is None:
            raise PlayerNotDraftableError("No draftable players remaining")

    # make_pick opens its own transaction — the block above only needed
    # one to compute rostered_positions/available consistently; there's
    # no cross-transaction race window that matters here since the
    # scheduler job is the only caller and draft_config's FOR UPDATE in
    # make_pick still serializes against a concurrent manual pick.
    return await make_pick(conn, season, owner_id, chosen["sleeper_player_id"], is_autopick=True)


async def undo_last_pick(conn, season: int) -> dict:
    async with conn.transaction():
        config = await conn.fetchrow("SELECT * FROM draft_config WHERE season = $1 FOR UPDATE", season)
        if config is None:
            raise DraftNotFoundError(f"No draft configured for season {season}")

        last_pick = await conn.fetchrow(
            "SELECT * FROM draft_picks WHERE season = $1 AND made_at IS NOT NULL AND is_keeper = FALSE "
            "ORDER BY made_at DESC LIMIT 1",
            season,
        )
        if last_pick is None:
            raise NothingToUndoError("No live pick to undo")

        team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2", season, last_pick["owner_id"]
        )
        await conn.execute(
            "DELETE FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            season, team_id, last_pick["sleeper_player_id"],
        )
        await conn.execute(
            "UPDATE draft_picks SET sleeper_player_id = NULL, is_autopick = FALSE, made_at = NULL "
            "WHERE season = $1 AND pick_number = $2",
            season, last_pick["pick_number"],
        )
        deadline = datetime.now(timezone.utc) + timedelta(seconds=config["pick_time_limit_seconds"])
        new_config = await conn.fetchrow(
            """
            UPDATE draft_config SET status = 'in_progress', current_pick_number = $1, current_pick_deadline = $2,
                completed_at = NULL
            WHERE season = $3 RETURNING *
            """,
            last_pick["pick_number"], deadline, season,
        )
        return {"undone_pick": dict(last_pick), "config": _config_dict(new_config)}


async def reset_draft(conn, season: int) -> None:
    """Wipes this season's draft entirely — config, every pick
    (keeper-prefilled or live), and every current_rosters row that
    draft seeded — so the commissioner can run a real mock draft to
    test the room, then start clean for the real one, or just change
    the draft order/roster shape before it's actually started. Works
    regardless of status (not_started/in_progress/paused/complete) —
    this is a deliberate commissioner-only nuke button, same trust
    level as undo_last_pick, just bigger in scope. No-op (not an
    error) if no draft exists yet for this season."""
    async with conn.transaction():
        await conn.execute(
            "DELETE FROM current_rosters WHERE season = $1 AND acquired_via IN ('draft', 'keeper')", season
        )
        await conn.execute("DELETE FROM draft_picks WHERE season = $1", season)
        await conn.execute("DELETE FROM draft_config WHERE season = $1", season)
