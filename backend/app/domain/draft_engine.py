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

from app.config import DEFAULT_LEAGUE_ID
from app.domain.draft_autopick import choose_autopick
from app.domain.draft_exceptions import (
    DraftAlreadyExistsError,
    DraftAlreadyStartedError,
    DraftNotFoundError,
    DraftNotInProgressError,
    InvalidDraftOrderError,
    KeeperResolutionError,
    KeeperSelectionsNotLockedError,
    NothingToUndoError,
    NotYourTurnError,
    PlayerAlreadyDraftedError,
    PlayerNotDraftableError,
)
from app.domain.roster_slots import total_draftable_slots
from app.queries import keepers as keeper_queries


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


async def create_draft(
    conn, season: int, draft_order: list[int], roster_slots: dict, pick_time_limit_seconds: int = 90,
    league_id: int = DEFAULT_LEAGUE_ID,
) -> None:
    """Refuses to overwrite an existing draft_config for this season —
    call reset_draft() first if you need to change the order or roster
    shape (e.g. after a mock draft, or the commissioner changing their
    mind before the real one). This is deliberately a hard stop, not a
    silent overwrite: draft_picks/current_rosters rows from a real
    draft are exactly the kind of data a silent re-setup could quietly
    destroy."""
    async with conn.transaction():
        exists = await conn.fetchval(
            "SELECT 1 FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
        )
        if exists:
            raise DraftAlreadyExistsError(
                f"A draft already exists for season {season} — reset it first if you want to change the order"
            )
        # A commissioner may have already set a real draft time before
        # deciding the order/roster shape (PUT /draft/schedule, held in
        # league_draft_schedule until a real draft exists — see that
        # table's own migration docstring). Carry it straight into the
        # new draft_config row rather than making them re-enter it, and
        # clear the standalone copy — draft_config.scheduled_start is
        # the single source of truth from here on.
        pre_set_schedule = await conn.fetchval(
            "DELETE FROM league_draft_schedule WHERE season = $1 AND league_id = $2 RETURNING scheduled_start",
            season, league_id,
        )
        rounds = total_draftable_slots(roster_slots)
        await conn.execute(
            """
            INSERT INTO draft_config (season, pick_time_limit_seconds, draft_order, roster_slots, league_id, scheduled_start)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            season, pick_time_limit_seconds, draft_order, json.dumps(roster_slots), league_id, pre_set_schedule,
        )
        # Same cleanup as the pre-set schedule above — draft_config.
        # roster_slots is the single source of truth from here on, so
        # any staged league_roster_slots_settings row (PUT /draft/
        # roster-slots, set ahead of a real draft) is now stale.
        await conn.execute(
            "DELETE FROM league_roster_slots_settings WHERE season = $1 AND league_id = $2", season, league_id
        )
        rows = plan_snake_order(draft_order, rounds)
        await conn.executemany(
            """
            INSERT INTO draft_picks (season, pick_number, round, round_pick, owner_id, league_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            [
                (season, pick_number, round_num, round_pick, owner_id, league_id)
                for pick_number, round_num, round_pick, owner_id in rows
            ],
        )


async def update_draft_order(
    conn, season: int, new_order: list[int], league_id: int = DEFAULT_LEAGUE_ID
) -> dict:
    """Reorders an existing, not-yet-started draft in place — an
    alternative to reset_draft + setup for the common case of wanting a
    different pick order without touching roster shape or the pick
    time limit. Only allowed while status is 'not_started' AND no pick
    has a player yet (covers both a live pick and a pre-seeded keeper —
    see seed_keeper_pick's own docstring: a keeper CAN be seeded before
    the draft technically starts). Reset the draft first if either
    applies — a keeper tied to a specific (round, owner_id) would need
    to be re-mapped onto a new pick_number, which this deliberately
    doesn't attempt to do automatically.

    new_order must be a reordering of the exact same owner_ids already
    in draft_config.draft_order — adding or removing an owner is a
    membership change (see leagues.py's add-team-for-member/reassign
    tools), not a reorder."""
    async with conn.transaction():
        config_row = await conn.fetchrow(
            "SELECT * FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
        )
        if config_row is None:
            raise DraftNotFoundError(f"No draft configured for season {season}")
        config = _config_dict(config_row)
        if config["status"] != "not_started":
            raise DraftAlreadyStartedError(
                f"Draft for season {season} has already started — reset it first to change the order"
            )
        if sorted(new_order) != sorted(config["draft_order"]):
            raise InvalidDraftOrderError("new_order must be a reordering of the same owners already in the draft")

        any_pick_made = await conn.fetchval(
            "SELECT 1 FROM draft_picks WHERE season = $1 AND league_id = $2 AND sleeper_player_id IS NOT NULL",
            season, league_id,
        )
        if any_pick_made:
            raise DraftAlreadyStartedError(
                f"A keeper has already been seeded for season {season} — reset the draft first to change the order"
            )

        rounds = total_draftable_slots(config["roster_slots"])
        await conn.execute("DELETE FROM draft_picks WHERE season = $1 AND league_id = $2", season, league_id)
        rows = plan_snake_order(new_order, rounds)
        await conn.executemany(
            """
            INSERT INTO draft_picks (season, pick_number, round, round_pick, owner_id, league_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            [
                (season, pick_number, round_num, round_pick, owner_id, league_id)
                for pick_number, round_num, round_pick, owner_id in rows
            ],
        )
        updated = await conn.fetchrow(
            "UPDATE draft_config SET draft_order = $1 WHERE season = $2 AND league_id = $3 RETURNING *",
            new_order, season, league_id,
        )
        return _config_dict(updated)


async def set_scheduled_start(conn, season: int, scheduled_start, league_id: int = DEFAULT_LEAGUE_ID) -> None:
    """When the real draft is planned for — independent of draft_order/
    roster_slots setup above, and settable/changeable on its own
    (PUT /draft/schedule) without touching either. Updates draft_config
    directly if a real draft already exists there; otherwise upserts
    into league_draft_schedule instead, so a commissioner can nail down
    the date before deciding the order (create_draft picks this up
    automatically once a real draft is set up — see its own comment)."""
    result = await conn.execute(
        "UPDATE draft_config SET scheduled_start = $1 WHERE season = $2 AND league_id = $3",
        scheduled_start, season, league_id,
    )
    if result == "UPDATE 0":
        await conn.execute(
            """
            INSERT INTO league_draft_schedule (season, league_id, scheduled_start, updated_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (season, league_id) DO UPDATE SET scheduled_start = EXCLUDED.scheduled_start, updated_at = now()
            """,
            season, league_id, scheduled_start,
        )


async def seed_keeper_pick(
    conn, season: int, owner_id: int, round_num: int, sleeper_player_id: str, league_id: int = DEFAULT_LEAGUE_ID
) -> None:
    """Pre-fills this owner's pick in `round_num` with their keeper —
    must run after create_draft (the pick rows must already exist) and
    before start_draft. Also seeds current_rosters, same as a live pick
    does, so a keeper shows up on the team's roster immediately."""
    async with conn.transaction():
        pick = await conn.fetchrow(
            "SELECT pick_number FROM draft_picks WHERE season = $1 AND round = $2 AND owner_id = $3 "
            "AND league_id = $4",
            season, round_num, owner_id, league_id,
        )
        if pick is None:
            raise DraftNotFoundError(f"No pick found for owner {owner_id} in round {round_num}")
        await conn.execute(
            """
            UPDATE draft_picks SET sleeper_player_id = $1, is_keeper = TRUE, made_at = now()
            WHERE season = $2 AND pick_number = $3 AND league_id = $4
            """,
            sleeper_player_id, season, pick["pick_number"], league_id,
        )
        team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2 AND league_id = $3",
            season, owner_id, league_id,
        )
        await conn.execute(
            """
            INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id)
            VALUES ($1, $2, $3, 'BE', 'keeper', $4)
            """,
            season, team_id, sleeper_player_id, league_id,
        )


async def seed_keepers_from_locked_selections(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> list[dict]:
    """The batch counterpart to seed_keeper_pick above: reads every
    LOCKED keeper_selections row for the season and pre-fills each
    owner's LAST round (this league's first year in the app — no prior
    in-app draft cost to base anything else on, per the project owner)
    with their keeper, all in one atomic operation.

    Requires the season's league_keeper_rules to be locked
    (KeeperSelectionsNotLockedError otherwise) and a draft_config to
    already exist and not have started yet (DraftNotFoundError /
    DraftNotInProgressError) — same "after create_draft, before
    start_draft" ordering seed_keeper_pick itself requires.

    Idempotent: an owner who already has an is_keeper=TRUE pick this
    season is skipped, so this is safe to re-run (e.g. a straggler
    owner's selection gets locked later).

    All-or-nothing on the crosswalk: if ANY remaining selection can't
    be resolved to a real players.sleeper_player_id (the espn_player_id
    crosswalk isn't 100% — see app/providers/sleeper/ingest.py), this
    raises KeeperResolutionError with the FULL list of failures (not
    just the first) and seeds nothing — a real draft is the wrong place
    to discover a partial, silently-incomplete keeper board."""
    rules = await keeper_queries.get_rules(conn, season, league_id)
    if rules is None or rules["locked_at"] is None:
        raise KeeperSelectionsNotLockedError(f"Keepers for season {season} aren't locked yet")

    config_row = await conn.fetchrow(
        "SELECT * FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
    )
    if config_row is None:
        raise DraftNotFoundError(f"No draft configured for season {season}")
    config = _config_dict(config_row)
    if config["status"] != "not_started":
        raise DraftNotInProgressError(
            f"Draft for season {season} has already started — keepers must be seeded before start_draft"
        )

    selections = await keeper_queries.get_all_selections(conn, season, league_id)
    already_seeded_owner_ids = {
        row["owner_id"]
        for row in await conn.fetch(
            "SELECT owner_id FROM draft_picks WHERE season = $1 AND is_keeper = TRUE AND league_id = $2",
            season, league_id,
        )
    }
    pending = [s for s in selections if s["owner_id"] not in already_seeded_owner_ids]

    resolved: list[dict] = []
    unresolved: list[dict] = []
    for selection in pending:
        sleeper_player_id = await conn.fetchval(
            "SELECT sleeper_player_id FROM players WHERE espn_player_id = $1", selection["espn_player_id"]
        )
        if sleeper_player_id is None:
            unresolved.append(
                {
                    "owner_id": selection["owner_id"],
                    "player_name": selection["player_name"],
                    "espn_player_id": selection["espn_player_id"],
                }
            )
        else:
            resolved.append({"owner_id": selection["owner_id"], "player_name": selection["player_name"],
                              "sleeper_player_id": sleeper_player_id})

    if unresolved:
        raise KeeperResolutionError(unresolved)

    last_round = total_draftable_slots(config["roster_slots"])
    seeded = []
    async with conn.transaction():
        for r in resolved:
            await seed_keeper_pick(conn, season, r["owner_id"], last_round, r["sleeper_player_id"], league_id)
            seeded.append({**r, "round": last_round})
    return seeded


async def _advance_to_next_open_pick(
    conn, season: int, from_pick_number: int, pick_time_limit_seconds: int, league_id: int = DEFAULT_LEAGUE_ID
) -> dict:
    """Walks forward from from_pick_number, skipping any pick that
    already has a player (a pre-filled keeper pick — see module
    docstring), and sets draft_config to either the next open pick
    (with a fresh deadline) or 'complete' if none remain. Returns the
    updated draft_config row."""
    pick_number = from_pick_number
    while True:
        pick = await conn.fetchrow(
            "SELECT * FROM draft_picks WHERE season = $1 AND pick_number = $2 AND league_id = $3",
            season, pick_number, league_id,
        )
        if pick is None:
            return _config_dict(await conn.fetchrow(
                """
                UPDATE draft_config
                SET status = 'complete', completed_at = now(), current_pick_deadline = NULL,
                    current_pick_number = $1
                WHERE season = $2 AND league_id = $3 RETURNING *
                """,
                pick_number, season, league_id,
            ))
        if pick["sleeper_player_id"] is None:
            deadline = datetime.now(timezone.utc) + timedelta(seconds=pick_time_limit_seconds)
            return _config_dict(await conn.fetchrow(
                """
                UPDATE draft_config SET current_pick_number = $1, current_pick_deadline = $2
                WHERE season = $3 AND league_id = $4 RETURNING *
                """,
                pick_number, deadline, season, league_id,
            ))
        pick_number += 1


async def start_draft(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> dict:
    async with conn.transaction():
        config = await conn.fetchrow(
            "SELECT * FROM draft_config WHERE season = $1 AND league_id = $2 FOR UPDATE", season, league_id
        )
        if config is None:
            raise DraftNotFoundError(f"No draft configured for season {season}")
        await conn.execute(
            "UPDATE draft_config SET status = 'in_progress', started_at = now() WHERE season = $1 AND league_id = $2",
            season, league_id,
        )
        return await _advance_to_next_open_pick(conn, season, 1, config["pick_time_limit_seconds"], league_id)


async def pause_draft(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> dict:
    async with conn.transaction():
        config = await conn.fetchrow(
            "SELECT * FROM draft_config WHERE season = $1 AND league_id = $2 FOR UPDATE", season, league_id
        )
        if config is None or config["status"] != "in_progress":
            raise DraftNotInProgressError(f"Draft for season {season} isn't in progress")
        remaining = None
        if config["current_pick_deadline"] is not None:
            remaining = max(0, int((config["current_pick_deadline"] - datetime.now(timezone.utc)).total_seconds()))
        return _config_dict(await conn.fetchrow(
            """
            UPDATE draft_config SET status = 'paused', paused_remaining_seconds = $1, current_pick_deadline = NULL
            WHERE season = $2 AND league_id = $3 RETURNING *
            """,
            remaining, season, league_id,
        ))


async def resume_draft(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> dict:
    async with conn.transaction():
        config = await conn.fetchrow(
            "SELECT * FROM draft_config WHERE season = $1 AND league_id = $2 FOR UPDATE", season, league_id
        )
        if config is None or config["status"] != "paused":
            raise DraftNotInProgressError(f"Draft for season {season} isn't paused")
        remaining = config["paused_remaining_seconds"] or config["pick_time_limit_seconds"]
        deadline = datetime.now(timezone.utc) + timedelta(seconds=remaining)
        return _config_dict(await conn.fetchrow(
            """
            UPDATE draft_config SET status = 'in_progress', current_pick_deadline = $1, paused_remaining_seconds = NULL
            WHERE season = $2 AND league_id = $3 RETURNING *
            """,
            deadline, season, league_id,
        ))


async def make_pick(
    conn, season: int, owner_id: int, sleeper_player_id: str, is_autopick: bool = False,
    league_id: int = DEFAULT_LEAGUE_ID,
) -> dict:
    async with conn.transaction():
        config = await conn.fetchrow(
            "SELECT * FROM draft_config WHERE season = $1 AND league_id = $2 FOR UPDATE", season, league_id
        )
        if config is None:
            raise DraftNotFoundError(f"No draft configured for season {season}")
        if config["status"] != "in_progress":
            raise DraftNotInProgressError(f"Draft for season {season} isn't in progress (status={config['status']})")

        pick = await conn.fetchrow(
            "SELECT * FROM draft_picks WHERE season = $1 AND pick_number = $2 AND league_id = $3",
            season, config["current_pick_number"], league_id,
        )
        if pick is None or pick["owner_id"] != owner_id:
            raise NotYourTurnError("It isn't your turn to pick")

        player = await conn.fetchrow(
            "SELECT sleeper_player_id, is_draftable FROM players WHERE sleeper_player_id = $1", sleeper_player_id
        )
        if player is None or not player["is_draftable"]:
            raise PlayerNotDraftableError(f"{sleeper_player_id} isn't a draftable player")

        already_drafted = await conn.fetchval(
            "SELECT 1 FROM draft_picks WHERE season = $1 AND sleeper_player_id = $2 AND league_id = $3",
            season, sleeper_player_id, league_id,
        )
        if already_drafted:
            raise PlayerAlreadyDraftedError(f"{sleeper_player_id} has already been drafted this season")

        await conn.execute(
            "UPDATE draft_picks SET sleeper_player_id = $1, is_autopick = $2, made_at = now() "
            "WHERE season = $3 AND pick_number = $4 AND league_id = $5",
            sleeper_player_id, is_autopick, season, pick["pick_number"], league_id,
        )
        team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2 AND league_id = $3",
            season, owner_id, league_id,
        )
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id) "
            "VALUES ($1, $2, $3, 'BE', 'draft', $4)",
            season, team_id, sleeper_player_id, league_id,
        )
        new_config = await _advance_to_next_open_pick(
            conn, season, pick["pick_number"] + 1, config["pick_time_limit_seconds"], league_id
        )
        made_pick = await conn.fetchrow(
            "SELECT * FROM draft_picks WHERE season = $1 AND pick_number = $2 AND league_id = $3",
            season, pick["pick_number"], league_id,
        )
        return {"pick": dict(made_pick), "config": new_config}


async def autopick(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> dict:
    """Called by the draft-clock scheduler job when a team's deadline
    passes with no pick made. Picks on that team's behalf using
    app/domain/draft_autopick.py's algorithm, then delegates to
    make_pick for the actual write (same validation, same
    turn-advancement)."""
    async with conn.transaction():
        config = _config_dict(
            await conn.fetchrow(
                "SELECT * FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
            ) or {}
        )
        if not config or config["status"] != "in_progress":
            raise DraftNotInProgressError(f"Draft for season {season} isn't in progress")
        pick = await conn.fetchrow(
            "SELECT * FROM draft_picks WHERE season = $1 AND pick_number = $2 AND league_id = $3",
            season, config["current_pick_number"], league_id,
        )
        if pick is None:
            raise DraftNotFoundError("No current pick to autopick for")
        owner_id = pick["owner_id"]

        team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2 AND league_id = $3",
            season, owner_id, league_id,
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
                SELECT sleeper_player_id FROM draft_picks
                WHERE season = $1 AND league_id = $2 AND sleeper_player_id IS NOT NULL
            )
            ORDER BY p.search_rank ASC NULLS LAST
            """,
            season, league_id,
        )
        chosen = choose_autopick(rostered_positions, config["roster_slots"], [dict(r) for r in available])
        if chosen is None:
            raise PlayerNotDraftableError("No draftable players remaining")

    # make_pick opens its own transaction — the block above only needed
    # one to compute rostered_positions/available consistently; there's
    # no cross-transaction race window that matters here since the
    # scheduler job is the only caller and draft_config's FOR UPDATE in
    # make_pick still serializes against a concurrent manual pick.
    return await make_pick(conn, season, owner_id, chosen["sleeper_player_id"], is_autopick=True, league_id=league_id)


async def undo_last_pick(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> dict:
    async with conn.transaction():
        config = await conn.fetchrow(
            "SELECT * FROM draft_config WHERE season = $1 AND league_id = $2 FOR UPDATE", season, league_id
        )
        if config is None:
            raise DraftNotFoundError(f"No draft configured for season {season}")

        last_pick = await conn.fetchrow(
            "SELECT * FROM draft_picks WHERE season = $1 AND made_at IS NOT NULL AND is_keeper = FALSE "
            "AND league_id = $2 ORDER BY made_at DESC LIMIT 1",
            season, league_id,
        )
        if last_pick is None:
            raise NothingToUndoError("No live pick to undo")

        team_id = await conn.fetchval(
            "SELECT id FROM teams_by_season WHERE season = $1 AND owner_id = $2 AND league_id = $3",
            season, last_pick["owner_id"], league_id,
        )
        await conn.execute(
            "DELETE FROM current_rosters WHERE season = $1 AND team_id = $2 AND sleeper_player_id = $3",
            season, team_id, last_pick["sleeper_player_id"],
        )
        await conn.execute(
            "UPDATE draft_picks SET sleeper_player_id = NULL, is_autopick = FALSE, made_at = NULL "
            "WHERE season = $1 AND pick_number = $2 AND league_id = $3",
            season, last_pick["pick_number"], league_id,
        )
        deadline = datetime.now(timezone.utc) + timedelta(seconds=config["pick_time_limit_seconds"])
        new_config = await conn.fetchrow(
            """
            UPDATE draft_config SET status = 'in_progress', current_pick_number = $1, current_pick_deadline = $2,
                completed_at = NULL
            WHERE season = $3 AND league_id = $4 RETURNING *
            """,
            last_pick["pick_number"], deadline, season, league_id,
        )
        return {"undone_pick": dict(last_pick), "config": _config_dict(new_config)}


async def reset_draft(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> None:
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
            "DELETE FROM current_rosters WHERE season = $1 AND league_id = $2 AND acquired_via IN ('draft', 'keeper')",
            season, league_id,
        )
        await conn.execute("DELETE FROM draft_picks WHERE season = $1 AND league_id = $2", season, league_id)
        await conn.execute("DELETE FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id)
