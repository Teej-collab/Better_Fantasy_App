"""
Value types for lineup planning. Deliberately independent of both
espn_api's Player objects (an unofficial library reading an unofficial
API — its shape can change under us) and ESPNProvider's DB-persisted
roster rows (synced only during NFL game windows, so possibly stale at
the moment someone asks to change their lineup). A mutation must always
plan against ESPN's actual live state, fetched fresh — see
lineup_client.py.
"""
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class RosterEntry:
    player_id: int
    player_name: str
    lineup_slot_id: int
    lineup_slot_label: str
    eligible_slot_ids: tuple[int, ...]
    pro_team: str
    injury_status: str | None
    # Best-effort kickoff time for the player's current-week game, used
    # for the lock check — None when espn_api couldn't resolve a
    # schedule entry (e.g. a bye week). See LineupLockedError.
    game_start: datetime | None = None
    # Real ESPN points for the current week — actual once the game's
    # played, projected either way. None when ESPN has no stats entry
    # for this player/week at all (e.g. a bye week), not when the value
    # is genuinely zero.
    points_scored: float | None = None
    points_projected: float | None = None


@dataclass(frozen=True)
class LineupChangePlan:
    """Returned only once every Phase 6 check has passed — by
    construction, a LineupChangePlan is always safe to attempt."""

    team_id: int
    player: RosterEntry
    from_slot_id: int
    to_slot_id: int
    # The single player currently occupying the destination slot, if the
    # slot's at capacity and needs to be bumped to make room. None means
    # there's an open spot in that slot already.
    displaced_player: RosterEntry | None


@dataclass(frozen=True)
class SwapPlan:
    """Returned only once both players are confirmed eligible for each
    other's current slot and neither is locked."""

    team_id: int
    player_a: RosterEntry
    player_b: RosterEntry


@dataclass(frozen=True)
class MutationResult:
    attempted: bool
    dry_run: bool
    # True only when a post-mutation live roster read confirmed the
    # expected state — see Phase 7. Always False when dry_run is True,
    # since nothing was actually sent to verify.
    verified: bool
    detail: str
