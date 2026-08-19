"""
Isolated ESPN lineup client.

This is deliberately separate from app/providers/espn/adapter.py (our
sync pipeline's read adapter, which writes into OUR database on a
schedule) and from raw espn_api.football.League. A lineup mutation must
always plan against ESPN's actual live state, not our DB — the DB is
only synced during NFL game windows (see app/game_windows.py) and can be
stale outside them, e.g. right after a waiver add clears. Every read
here goes straight to ESPN, live, every time.

WRITE STATUS: not implemented. See ESPN_LINEUP_WRITE.md for why —
in short, no public source has ever shown a verified 2026 request body
for ESPN's lineup-change endpoint, and Phase 12 of this investigation
explicitly says to stop rather than guess. set_lineup()/swap_players()
build and validate a plan (the full Phase 6 read-before-write sequence)
and then, depending on config.dry_run:
  - dry_run=True (the default): log the exact mutation that WOULD be
    sent, with credentials redacted, and return a MutationResult that
    says so. No network write call is made.
  - dry_run=False: raise WriteNotVerifiedError. There is currently no
    code path that sends a real write request — this isn't a runtime
    toggle waiting to be flipped, it's a hole waiting for the real
    request format once we have a capture to verify it against.
"""
import logging
from datetime import datetime, timezone

from espn_api.football import League

from app.providers.espn.config import ESPNConfig
from app.providers.espn.lineup_exceptions import (
    AmbiguousDisplacementError,
    InvalidSlotError,
    LineupLockedError,
    MutationVerificationFailedError,
    PlayerNotFoundError,
    SlotIneligibleError,
    TeamNotFoundError,
    WriteNotVerifiedError,
)
from app.providers.espn.lineup_models import LineupChangePlan, MutationResult, RosterEntry, SwapPlan
from app.providers.espn.slots import LineupSlot, slot_id_from_label, slot_label

logger = logging.getLogger(__name__)

_NON_DISPLACING_SLOTS = {LineupSlot.BENCH, LineupSlot.IR}


class ESPNLineupClient:
    def __init__(self, config: ESPNConfig | None = None):
        self.config = config or ESPNConfig()

    # ---- reads (live, never our DB) -----------------------------------

    def get_league(self, season: int | None = None) -> League:
        return League(
            league_id=self.config.league_id,
            year=season or self.config.active_season,
            espn_s2=self.config.espn_s2,
            swid=self.config.swid,
        )

    def get_team(self, team_id: int, season: int | None = None):
        league = self.get_league(season)
        for team in league.teams:
            if team.team_id == team_id:
                return team
        raise TeamNotFoundError(f"No team with id {team_id} in league {self.config.league_id}")

    def get_roster(self, team_id: int, season: int | None = None) -> list[RosterEntry]:
        league = self.get_league(season)
        team = self.get_team(team_id, season)
        current_week = league.current_week
        return [self._to_roster_entry(p, current_week) for p in team.roster]

    def get_player(self, team_id: int, player_name: str, season: int | None = None) -> RosterEntry:
        roster = self.get_roster(team_id, season)
        needle = player_name.strip().lower()
        for entry in roster:
            if entry.player_name.strip().lower() == needle:
                return entry
        raise PlayerNotFoundError(
            f"No player named {player_name!r} on team {team_id}'s current roster"
        )

    def verify_lineup(
        self, team_id: int, expected_slot_by_player_id: dict[int, int], season: int | None = None
    ) -> bool:
        """Re-fetches the live roster and checks every given player is in
        the expected slot. Phase 7's core rule: this is the ONLY thing
        that gets to call a mutation "successful", never an HTTP status
        code alone."""
        roster = self.get_roster(team_id, season)
        actual_by_id = {entry.player_id: entry.lineup_slot_id for entry in roster}
        return all(
            actual_by_id.get(player_id) == slot_id
            for player_id, slot_id in expected_slot_by_player_id.items()
        )

    @staticmethod
    def _to_roster_entry(player, current_week: int) -> RosterEntry:
        schedule_entry = getattr(player, "schedule", {}).get(current_week)
        game_start = schedule_entry["date"] if schedule_entry else None
        return RosterEntry(
            player_id=player.playerId,
            player_name=player.name,
            lineup_slot_id=_slot_id_of(player),
            lineup_slot_label=slot_label(_slot_id_of(player)),
            eligible_slot_ids=tuple(
                sid for sid in (slot_id_from_label(lbl) for lbl in player.eligibleSlots) if sid is not None
            ),
            pro_team=player.proTeam,
            injury_status=player.injuryStatus,
            game_start=game_start,
        )

    # ---- planning (Phase 6: read, validate, only then allow a write) --

    def plan_lineup_change(
        self, team_id: int, player_name: str, to_slot: str | int, season: int | None = None
    ) -> LineupChangePlan:
        roster = self.get_roster(team_id, season)
        player = self._find(roster, player_name)

        to_slot_id = to_slot if isinstance(to_slot, int) else slot_id_from_label(to_slot)
        if to_slot_id is None:
            raise InvalidSlotError(f"{to_slot!r} isn't a recognized ESPN lineup slot")

        if to_slot_id not in player.eligible_slot_ids:
            raise SlotIneligibleError(
                f"{player.player_name} isn't eligible for slot {slot_label(to_slot_id)} "
                f"(eligible: {[slot_label(s) for s in player.eligible_slot_ids]})"
            )

        self._check_not_locked(player)

        displaced_player = self._find_displacement(roster, to_slot_id, season)

        return LineupChangePlan(
            team_id=team_id,
            player=player,
            from_slot_id=player.lineup_slot_id,
            to_slot_id=to_slot_id,
            displaced_player=displaced_player,
        )

    def plan_swap(
        self, team_id: int, player_a_name: str, player_b_name: str, season: int | None = None
    ) -> SwapPlan:
        roster = self.get_roster(team_id, season)
        player_a = self._find(roster, player_a_name)
        player_b = self._find(roster, player_b_name)

        if player_b.lineup_slot_id not in player_a.eligible_slot_ids:
            raise SlotIneligibleError(
                f"{player_a.player_name} isn't eligible for {player_b.player_name}'s slot "
                f"({slot_label(player_b.lineup_slot_id)})"
            )
        if player_a.lineup_slot_id not in player_b.eligible_slot_ids:
            raise SlotIneligibleError(
                f"{player_b.player_name} isn't eligible for {player_a.player_name}'s slot "
                f"({slot_label(player_a.lineup_slot_id)})"
            )

        self._check_not_locked(player_a)
        self._check_not_locked(player_b)

        return SwapPlan(team_id=team_id, player_a=player_a, player_b=player_b)

    @staticmethod
    def _find(roster: list[RosterEntry], player_name: str) -> RosterEntry:
        needle = player_name.strip().lower()
        for entry in roster:
            if entry.player_name.strip().lower() == needle:
                return entry
        raise PlayerNotFoundError(f"No player named {player_name!r} on this roster")

    @staticmethod
    def _check_not_locked(player: RosterEntry) -> None:
        if player.game_start is None:
            return
        now = datetime.now(timezone.utc)
        game_start = player.game_start
        if game_start.tzinfo is None:
            game_start = game_start.replace(tzinfo=timezone.utc)
        if game_start <= now:
            raise LineupLockedError(
                f"{player.player_name}'s game started at {game_start.isoformat()} — lineup is locked"
            )

    def _find_displacement(
        self, roster: list[RosterEntry], to_slot_id: int, season: int | None
    ) -> RosterEntry | None:
        if to_slot_id in _NON_DISPLACING_SLOTS:
            return None  # bench/IR always have room in practice for this use case

        occupants = [e for e in roster if e.lineup_slot_id == to_slot_id]
        capacity = self._slot_capacity(to_slot_id, season)
        if capacity is None or len(occupants) < capacity:
            return None  # open spot, nothing to bump

        if len(occupants) == 1:
            return occupants[0]

        raise AmbiguousDisplacementError(
            f"Slot {slot_label(to_slot_id)} is full and has {len(occupants)} current occupants — "
            "use swap_players() with an explicit second player instead"
        )

    def _slot_capacity(self, slot_id: int, season: int | None) -> int | None:
        league = self.get_league(season)
        return league.settings.position_slot_counts.get(slot_label(slot_id))

    # ---- writes (see module docstring — not implemented) --------------

    def set_lineup(
        self, team_id: int, player_name: str, to_slot: str | int, season: int | None = None
    ) -> MutationResult:
        plan = self.plan_lineup_change(team_id, player_name, to_slot, season)
        return self._send_mutation(
            f"league={self.config.league_id} team={team_id} "
            f"player={plan.player.player_id} from_slot={plan.from_slot_id} to_slot={plan.to_slot_id}"
            + (
                f" displaces={plan.displaced_player.player_id}"
                if plan.displaced_player
                else ""
            )
        )

    def swap_players(
        self, team_id: int, player_a_name: str, player_b_name: str, season: int | None = None
    ) -> MutationResult:
        plan = self.plan_swap(team_id, player_a_name, player_b_name, season)
        return self._send_mutation(
            f"league={self.config.league_id} team={team_id} swap "
            f"player_a={plan.player_a.player_id}(slot={plan.player_a.lineup_slot_id}) "
            f"player_b={plan.player_b.player_id}(slot={plan.player_b.lineup_slot_id})"
        )

    def _send_mutation(self, description: str) -> MutationResult:
        if self.config.dry_run:
            logger.info("ESPN lineup mutation (DRY RUN, not sent): %s dry_run=true", description)
            return MutationResult(
                attempted=False,
                dry_run=True,
                verified=False,
                detail=f"DRY RUN — would send: {description}",
            )

        # No verified write request exists yet — see ESPN_LINEUP_WRITE.md.
        # This is the guardrail from Phase 7: refuse rather than guess.
        logger.error("ESPN lineup mutation blocked (write not verified): %s dry_run=false", description)
        raise WriteNotVerifiedError(
            "ESPN's lineup-change write endpoint has not been verified against a real captured "
            "request yet — see ESPN_LINEUP_WRITE.md. Refusing to send an unverified request. "
            "Set ESPN_DRY_RUN=true to see what would be attempted."
        )


def _slot_id_of(player) -> int:
    """player.lineupSlot is espn_api's own label string for this
    player's current slot (e.g. "BE", "RB/WR/TE") — resolved back to an
    ID via slots.slot_id_from_label, NOT via POSITION_MAP directly (see
    that function's docstring for why the naive reverse lookup silently
    breaks for bench/IR/flex). -1 means unresolved, not a real slot."""
    resolved = slot_id_from_label(player.lineupSlot)
    return resolved if resolved is not None else -1
