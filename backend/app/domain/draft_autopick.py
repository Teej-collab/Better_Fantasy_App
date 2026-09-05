"""
Pure autopick logic for the real-time draft (app/domain/draft_engine.py
calls this when a team's pick clock expires — see project plan Phase B).
No DB access, no network — fully unit-testable against plain lists.

This app has no player rankings of its own, so "best available" means
Sleeper's own search_rank (a rough overall-rank proxy, lower is better —
see app/providers/sleeper/). The algorithm is true best-player-available,
matching how ESPN's and Sleeper's own auto-draft actually behave: take
the single best-ranked player on the board, full stop — real-world ADP
already encodes positional scarcity (that's *why* QBs go in round 3+
rather than round 1 despite every roster needing exactly one), so
layering a fixed "fill starting slots in this order" rule on top of it
double-counts that scarcity and produces exactly the wrong result. This
replaces an earlier version that walked a fixed QB-then-RB-then-WR-then-
TE priority order and always returned the first under-filled slot — since
every empty roster starts at zero for all of them, that always picked a
QB first regardless of rank, a real reported bug (2026-09 mock draft
autodrafting QBs in round 1).

Two guardrails stack, tightest wins:
- Physical: a position this roster has no plausible remaining room for
  (more players at that position than every starting slot, flex
  allowance, and the full bench combined could ever use) is skipped —
  always on, no configuration needed.
- Configured: a commissioner-set per-position roster max (see
  league_roster_slots_settings/draft_config's own position_max column,
  same idea as ESPN's own "QB (4 max)" league-settings display) is
  skipped once reached, same as the physical guardrail above but a real
  number instead of a worst-case one. Without this, the physical
  guardrail alone genuinely allows something like 8 QBs on an
  otherwise-ordinary roster (1 starting slot + a full bench, unlikely
  but not degenerate) — a real reported concern (2026-09, an
  autopick-heavy draft hoarding one position), not a hypothetical.
  position_max is optional per-league/season; a position with no
  configured entry falls back to the physical guardrail alone, so
  every league that's never touched this setting keeps behaving
  exactly as it always has.
"""
from app.domain.roster_slots import FLEX_ELIGIBLE_POSITIONS, FLEX_SLOT_LABEL, POSITION_TO_SLOT_LABEL


def _position_capacity(position: str, roster_slots: dict[str, int], position_max: dict[str, int] | None = None) -> int:
    """The most players at `position` this roster will draft: the
    physical ceiling (its own starting slot, plus every flex slot — a
    deliberate over-count, see module docstring — plus the entire
    bench), narrowed further by a configured position_max for this
    position if one exists. min(), not a straight replacement, so a
    commissioner-configured value that's larger than physically
    possible (e.g. left over from a smaller bench a prior season) can
    never loosen this below the real physical ceiling."""
    label = POSITION_TO_SLOT_LABEL.get(position)
    capacity = roster_slots.get(label, 0) if label else 0
    if position in FLEX_ELIGIBLE_POSITIONS:
        capacity += roster_slots.get(FLEX_SLOT_LABEL, 0)
    capacity += roster_slots.get("BE", 0)
    configured = (position_max or {}).get(position)
    if configured is not None:
        capacity = min(capacity, configured)
    return capacity


def choose_autopick(
    rostered_positions: list[str], roster_slots: dict[str, int], available_players: list[dict],
    position_max: dict[str, int] | None = None,
) -> dict | None:
    """available_players: list of {"sleeper_player_id", "position",
    "search_rank"}, already filtered to undrafted/draftable and sorted
    by search_rank ascending (None/unranked last — caller's
    responsibility, see draft_engine.py's query). Returns the single
    best-available player overall — real best-player-available, not a
    needs-first fill (see module docstring) — filtering out only
    positions this roster has no room left for (physical ceiling,
    tightened by position_max if the league has one configured — see
    _position_capacity). Returns None if nothing is available
    (shouldn't happen in practice — the draft pool is far larger than
    any one draft)."""
    if not available_players:
        return None

    counts: dict[str, int] = {}
    for pos in rostered_positions:
        counts[pos] = counts.get(pos, 0) + 1

    eligible = [
        p for p in available_players
        if counts.get(p["position"], 0) < _position_capacity(p["position"], roster_slots, position_max)
    ]
    pool = eligible if eligible else available_players
    return pool[0]
