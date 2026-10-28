"""
What a keeper costs (2026-10-28): which of your draft picks he takes.
Set per league in league_keeper_rules.cost_mode:

- last_round (default, ESPN's): your final picks, the last round first,
  then the one before for a second keeper.
- round_drafted: the round he went in here last season (a keeper last
  year costs that keeper round again); a free-agent pickup or anyone
  this league didn't draft costs the last round.
- escalating: round_drafted, but every year he's already been kept
  costs cost_step rounds earlier, never earlier than round 1.

Two keepers that cost the same round, or a round whose pick you traded
away, move to the next earlier round you still hold (later if none).
"""
from app.domain.roster_slots import DEFAULT_ROSTER_SLOTS, total_draftable_slots

COST_MODES = ("last_round", "round_drafted", "escalating")


async def last_round(conn, season: int, league_id: int) -> int:
    from app.queries.draft import get_effective_roster_slots

    slots = (
        await get_effective_roster_slots(conn, season, league_id)
        or await get_effective_roster_slots(conn, season - 1, league_id)
        or DEFAULT_ROSTER_SLOTS
    )
    return total_draftable_slots(slots)


def base_cost(mode: str, step: int, last: int, prior_round: int | None, kept_before: bool) -> int:
    """The round a keeper costs before any clash with another keeper.
    prior_round: where he went here last season (drafted or kept)."""
    if mode == "last_round" or prior_round is None:
        return last
    if mode == "escalating" and kept_before:
        return max(1, prior_round - step)
    return max(1, min(prior_round, last))


async def prior_rounds(conn, season: int, league_id: int, sleeper_ids: list[str]) -> dict[str, int]:
    rows = await conn.fetch(
        "SELECT sleeper_player_id, round FROM draft_picks WHERE season = $1 AND league_id = $2 "
        "AND sleeper_player_id = ANY($3::text[])",
        season - 1, league_id, sleeper_ids,
    )
    return {r["sleeper_player_id"]: r["round"] for r in rows}


def assign_rounds(costs: list[tuple[str, int]], held: set[int]) -> dict[str, int]:
    """Each keeper gets his cost round if you hold that pick and no
    other keeper took it, else the next earlier one you hold, else the
    next later. The latest-costing keepers are placed first."""
    free = set(held)
    out: dict[str, int] = {}
    for key, cost in sorted(costs, key=lambda c: -c[1]):
        if not free:
            break
        earlier = [r for r in free if r <= cost]
        pick = max(earlier) if earlier else min(free)
        out[key] = pick
        free.discard(pick)
    return out


async def rules(conn, season: int, league_id: int) -> tuple[str, int]:
    row = await conn.fetchrow(
        "SELECT cost_mode, cost_step FROM league_keeper_rules WHERE season = $1 AND league_id = $2", season, league_id
    )
    return (row["cost_mode"], row["cost_step"]) if row else ("last_round", 1)


async def cost_rounds(
    conn, season: int, league_id: int, keepers: list[tuple[str, bool]]
) -> dict[str, int]:
    """{sleeper_player_id: round it costs} for one manager's keepers,
    each (sleeper_player_id, kept last year too), before clashes."""
    mode, step = await rules(conn, season, league_id)
    last = await last_round(conn, season, league_id)
    prior = await prior_rounds(conn, season, league_id, [k for k, _ in keepers]) if mode != "last_round" else {}
    return {pid: base_cost(mode, step, last, prior.get(pid), kept) for pid, kept in keepers}
