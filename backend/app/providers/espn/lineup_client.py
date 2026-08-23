"""
Isolated ESPN lineup client.

This is deliberately separate from app/providers/espn/adapter.py (our
sync pipeline's read adapter, which writes into OUR database on a
schedule) and from raw espn_api.football.League. A lineup mutation must
always plan against ESPN's actual live state, not our DB — the DB is
only synced while a real NFL game is live (see app/scheduler.py) and can
be stale outside that, e.g. right after a waiver add clears. Every read
here goes straight to ESPN, live, every time.

WRITE STATUS: implemented, gated behind config.dry_run (default True) —
see ESPN_LINEUP_WRITE.md for the full capture and verification status.
  - The 1-item request body (move a single player into an OPEN slot —
    no displacement) is VERIFIED against a real captured lineup change
    on 2026-08-19: host, path, method, headers, and body all confirmed.
  - The 2-item body used for a swap or a displacement (bumping whoever
    already occupies the destination slot) is ALSO VERIFIED — a second
    2026-08-19 capture of a real two-player swap confirmed it's exactly
    the mirrored shape we'd inferred (each player gets their own LINEUP
    entry, with the two players' from/to slots swapped between them).
  - _send_mutation still refuses anything with more than 2 items — that
    shape has never come up in a capture and nothing in this client's
    planning logic currently produces it, so there's nothing to verify
    it against. If that ever changes, verify it the same way these two
    were verified before relaxing the guard.
set_lineup()/swap_players() always build and validate a plan first (the
full Phase 6 read-before-write sequence), then, depending on
config.dry_run:
  - dry_run=True (the default): log the exact mutation that WOULD be
    sent, with credentials redacted, and return a MutationResult that
    says so. No network write call is made.
  - dry_run=False: actually POST to ESPN, then verify_lineup() the
    result before ever calling it a success (Phase 7 — an HTTP 200 is
    never enough on its own). Never retries on timeout/error — see
    ESPNWriteTimeoutError's docstring for why that's specifically
    dangerous here.

OWN-TEAM VS. OTHER-TEAM WRITES: every capture so far authenticated as a
member writing their OWN team's roster. Whether these same credentials
can write a DIFFERENT team's roster — e.g. a commissioner managing
another owner's lineup — is unverified; ESPN's real request body does
carry an `isLeagueManager` flag, which set_lineup()/swap_players() now
expose as `as_league_manager` (default False, matching every verified
capture) specifically so that question can be tested deliberately rather
than guessed at. Until it's tested, assume it does nothing.
"""
import logging
from datetime import datetime, timezone

import requests
from espn_api.football import League

from app.providers.espn.config import ESPNConfig
from app.providers.espn.lineup_exceptions import (
    AmbiguousDisplacementError,
    ESPNWriteHTTPError,
    ESPNWriteMalformedResponseError,
    ESPNWriteTimeoutError,
    InvalidSlotError,
    LineupLockedError,
    MutationVerificationFailedError,
    PlayerAlreadyRosteredError,
    PlayerNotFoundError,
    RosterFullError,
    SlotIneligibleError,
    TeamNotFoundError,
    WriteNotVerifiedError,
)
from app.providers.espn.lineup_models import AddPlayerPlan, LineupChangePlan, MutationResult, RosterEntry, SwapPlan
from app.providers.espn.slots import LineupSlot, slot_id_from_label, slot_label

logger = logging.getLogger(__name__)

_NON_DISPLACING_SLOTS = {LineupSlot.BENCH, LineupSlot.IR}

# --- write endpoint, VERIFIED 2026-08-19 against a real captured lineup
# change — see ESPN_LINEUP_WRITE.md. Mirrors the read host
# (lm-api-reads -> lm-api-writes) exactly as the community had guessed,
# but the path is NOT the commonly-cited "/roster/" — it's
# "/transactions/", confirmed for real.
_WRITE_BASE = "https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl"
# ESPN's frontend build fingerprint, captured from a real request. It is
# NOT verified whether this needs to match exactly, just needs to be
# present, or is safely omittable — if real writes start failing with an
# otherwise-valid request, re-capture this first (see
# ESPN_LINEUP_WRITE.md's DevTools instructions).
_PLATFORM_VERSION = "5e254affd13eaa961c7dffbd9de59d867a2e0acf"
_WRITE_TIMEOUT_SECONDS = 10


def _write_url(league_id: int, year: int) -> str:
    return f"{_WRITE_BASE}/seasons/{year}/segments/0/leagues/{league_id}/transactions/"


def _write_headers() -> dict:
    # VERIFIED from the 2026-08-19 capture.
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "x-fantasy-platform": "espn-fantasy-web",
        "x-fantasy-source": "kona",
    }


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

        # ESPN reports current_week = 0 during preseason (not a real
        # week — see Team page's own current-week fallback, TODO.md
        # Phase 7) and player.stats[0] under that key holds a
        # season-aggregate projection, not a real per-week one. Same
        # fallback to week 1 as everywhere else this comes up.
        stats_week = current_week if current_week >= 1 else 1
        week_stats = getattr(player, "stats", {}).get(stats_week, {})
        points_scored = week_stats.get("points")
        points_projected = week_stats.get("projected_points")

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
            points_scored=points_scored,
            points_projected=points_projected,
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

    def plan_add_player(
        self,
        team_id: int,
        added_player_id: int,
        added_player_name: str,
        added_position: str,
        added_pro_team: str,
        drop_player_name: str | None = None,
        season: int | None = None,
    ) -> AddPlayerPlan:
        """PREVIEW ONLY — there is no add_player()/submit side to this,
        unlike set_lineup()/swap_players(). Actually submitting a free-
        agent add or waiver claim to ESPN is a different, unverified
        write endpoint (see app/providers/espn/free_agents.py's module
        note and ESPN_LINEUP_WRITE.md) — this only validates against
        the live roster and reports exactly what adding this player
        would do.

        added_player_id/name/position/pro_team come from the caller
        (the free-agent listing the frontend already has, from
        League.free_agents() via app/providers/espn/free_agents.py) —
        this client doesn't re-fetch free-agent data itself, since
        get_roster()/get_team() only ever look at ROSTERED players."""
        roster = self.get_roster(team_id, season)
        if any(e.player_id == added_player_id for e in roster):
            raise PlayerAlreadyRosteredError(
                f"{added_player_name} is already on this roster"
            )

        capacity = self._roster_capacity(season)
        dropped_player = None
        if len(roster) >= capacity:
            if not drop_player_name:
                raise RosterFullError(
                    f"Roster is full ({len(roster)}/{capacity}) — choose a player to drop "
                    f"to add {added_player_name}"
                )
            dropped_player = self._find(roster, drop_player_name)

        return AddPlayerPlan(
            team_id=team_id,
            added_player_id=added_player_id,
            added_player_name=added_player_name,
            added_position=added_position,
            added_pro_team=added_pro_team,
            roster_size_before=len(roster),
            roster_capacity=capacity,
            dropped_player=dropped_player,
        )

    def _roster_capacity(self, season: int | None) -> int:
        """Every real configured slot, starting and bench alike — sum of
        league.settings.position_slot_counts (the same source
        _slot_capacity already reads per-slot from) rather than a
        hardcoded roster size, so this stays correct if the league's
        roster construction ever changes."""
        league = self.get_league(season)
        return sum(league.settings.position_slot_counts.values())

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

    # ---- writes (see module docstring for verification status) --------

    def set_lineup(
        self,
        team_id: int,
        player_name: str,
        to_slot: str | int,
        season: int | None = None,
        as_league_manager: bool = False,
    ) -> MutationResult:
        plan = self.plan_lineup_change(team_id, player_name, to_slot, season)
        items = self._lineup_change_items(plan)
        expected = {plan.player.player_id: plan.to_slot_id}
        if plan.displaced_player is not None:
            expected[plan.displaced_player.player_id] = plan.from_slot_id

        description = (
            f"league={self.config.league_id} team={team_id} "
            f"player={plan.player.player_id} from_slot={plan.from_slot_id} to_slot={plan.to_slot_id}"
            + (f" displaces={plan.displaced_player.player_id}" if plan.displaced_player else "")
            + (" as_league_manager=true" if as_league_manager else "")
        )
        return self._send_mutation(team_id, items, expected, season, description, as_league_manager)

    def swap_players(
        self,
        team_id: int,
        player_a_name: str,
        player_b_name: str,
        season: int | None = None,
        as_league_manager: bool = False,
    ) -> MutationResult:
        plan = self.plan_swap(team_id, player_a_name, player_b_name, season)
        items = [
            {
                "playerId": plan.player_a.player_id,
                "type": "LINEUP",
                "fromLineupSlotId": plan.player_a.lineup_slot_id,
                "toLineupSlotId": plan.player_b.lineup_slot_id,
            },
            {
                "playerId": plan.player_b.player_id,
                "type": "LINEUP",
                "fromLineupSlotId": plan.player_b.lineup_slot_id,
                "toLineupSlotId": plan.player_a.lineup_slot_id,
            },
        ]
        expected = {
            plan.player_a.player_id: plan.player_b.lineup_slot_id,
            plan.player_b.player_id: plan.player_a.lineup_slot_id,
        }
        description = (
            f"league={self.config.league_id} team={team_id} swap "
            f"player_a={plan.player_a.player_id}(slot={plan.player_a.lineup_slot_id}) "
            f"player_b={plan.player_b.player_id}(slot={plan.player_b.lineup_slot_id})"
            + (" as_league_manager=true" if as_league_manager else "")
        )
        return self._send_mutation(team_id, items, expected, season, description, as_league_manager)

    @staticmethod
    def _lineup_change_items(plan: LineupChangePlan) -> list[dict]:
        items = [
            {
                "playerId": plan.player.player_id,
                "type": "LINEUP",
                "fromLineupSlotId": plan.from_slot_id,
                "toLineupSlotId": plan.to_slot_id,
            }
        ]
        if plan.displaced_player is not None:
            # VERIFIED shape — matches the real 2026-08-19 two-player
            # swap capture exactly (see ESPN_LINEUP_WRITE.md): each
            # player gets their own LINEUP entry, from/to slots mirrored
            # between the two.
            items.append(
                {
                    "playerId": plan.displaced_player.player_id,
                    "type": "LINEUP",
                    "fromLineupSlotId": plan.to_slot_id,
                    "toLineupSlotId": plan.from_slot_id,
                }
            )
        return items

    def _send_mutation(
        self,
        team_id: int,
        items: list[dict],
        expected_slot_by_player_id: dict[int, int],
        season: int | None,
        description: str,
        as_league_manager: bool = False,
    ) -> MutationResult:
        if self.config.dry_run:
            logger.info("ESPN lineup mutation (DRY RUN, not sent): %s dry_run=true", description)
            return MutationResult(
                attempted=False,
                dry_run=True,
                verified=False,
                detail=f"DRY RUN — would send: {description}",
            )

        if len(items) > 2:
            # Both the 1-item (open-slot move) and 2-item (swap/
            # displacement) shapes are VERIFIED against real ESPN
            # captures — see ESPN_LINEUP_WRITE.md. Nothing in this
            # client's planning logic currently produces more than 2
            # items, so a 3+ item request has never been captured or
            # even exercised; refuse it rather than guess, the same way
            # the 2-item shape was refused before it was verified.
            logger.error("ESPN lineup mutation blocked (%d-item shape unverified): %s", len(items), description)
            raise WriteNotVerifiedError(
                f"This mutation needs a {len(items)}-item request body, and only 1- and 2-item "
                "shapes have been verified against real ESPN captures so far — see "
                "ESPN_LINEUP_WRITE.md. Refusing to send an unverified request shape."
            )

        year = season or self.config.active_season
        body = {
            # VERIFIED only for the false/own-team case (see
            # ESPN_LINEUP_WRITE.md). Whether ESPN actually honors true
            # here to unlock writing another team's roster — the
            # question as_league_manager exists to test — is NOT
            # verified; that's exactly what this parameter is for.
            "isLeagueManager": as_league_manager,
            "teamId": team_id,
            "type": "ROSTER",
            "memberId": self.config.swid,
            "executionType": "EXECUTE",
            "items": items,
        }
        cookies = {"espn_s2": self.config.espn_s2, "SWID": self.config.swid}

        logger.info("ESPN lineup mutation (SENDING): %s dry_run=false", description)
        try:
            response = requests.post(
                _write_url(self.config.league_id, year),
                params={"platformVersion": _PLATFORM_VERSION},
                json=body,
                headers=_write_headers(),
                cookies=cookies,
                timeout=_WRITE_TIMEOUT_SECONDS,
            )
        except requests.exceptions.Timeout as e:
            logger.error("ESPN lineup mutation timed out (outcome UNKNOWN, not retrying): %s", description)
            raise ESPNWriteTimeoutError(
                "ESPN write request timed out — ESPN may or may not have applied it. Do NOT "
                "retry blindly (see ESPNWriteTimeoutError). Call verify_lineup() to find out "
                "what actually happened before doing anything else."
            ) from e
        except requests.exceptions.RequestException as e:
            logger.error("ESPN lineup mutation network error: %s", description)
            raise ESPNWriteHTTPError(0, self._redact(str(e))) from e

        if response.status_code >= 300:
            logger.error(
                "ESPN lineup mutation rejected: %s status=%d", description, response.status_code
            )
            raise ESPNWriteHTTPError(response.status_code, self._redact(response.text[:500]))

        try:
            payload = response.json()
        except ValueError as e:
            raise ESPNWriteMalformedResponseError(
                f"ESPN returned HTTP {response.status_code} but the body wasn't valid JSON"
            ) from e

        espn_status = payload.get("status")
        logger.info("ESPN lineup mutation response: %s espn_status=%s", description, espn_status)

        # Phase 7's core rule: an accepted-looking response is not proof.
        # Only a follow-up live roster read counts.
        if not self.verify_lineup(team_id, expected_slot_by_player_id, season):
            raise MutationVerificationFailedError(
                f"ESPN responded (status={espn_status}) but a follow-up roster read didn't show "
                f"the expected lineup: {description}"
            )

        return MutationResult(
            attempted=True,
            dry_run=False,
            verified=True,
            detail=f"Applied and verified (espn_status={espn_status}): {description}",
        )

    def _redact(self, text: str) -> str:
        """Strips this client's own live credential values out of
        arbitrary text before it's logged or raised in an exception —
        ESPN's write response echoes `memberId` back, which is the same
        GUID as the SWID cookie. See Phase 9's "never log credentials"
        rule."""
        redacted = text
        if self.config.swid:
            redacted = redacted.replace(self.config.swid, "<redacted-member-id>")
        if self.config.espn_s2:
            redacted = redacted.replace(self.config.espn_s2, "<redacted-espn-s2>")
        return redacted


def _slot_id_of(player) -> int:
    """player.lineupSlot is espn_api's own label string for this
    player's current slot (e.g. "BE", "RB/WR/TE") — resolved back to an
    ID via slots.slot_id_from_label, NOT via POSITION_MAP directly (see
    that function's docstring for why the naive reverse lookup silently
    breaks for bench/IR/flex). -1 means unresolved, not a real slot."""
    resolved = slot_id_from_label(player.lineupSlot)
    return resolved if resolved is not None else -1
