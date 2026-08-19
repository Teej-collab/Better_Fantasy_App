"""
Exception hierarchy for the lineup mutation layer. Deliberately specific
per Phase 7's "never silently fail" requirement — a caller (eventually a
Discord command) needs to tell these apart to give a useful error
message instead of a generic failure.
"""


class ESPNLineupError(Exception):
    """Base for every error raised by app/providers/espn/lineup_client.py."""


class TeamNotFoundError(ESPNLineupError):
    pass


class PlayerNotFoundError(ESPNLineupError):
    pass


class InvalidSlotError(ESPNLineupError):
    """The requested destination slot isn't a real ESPN slot label/ID at all."""


class SlotIneligibleError(ESPNLineupError):
    """The player isn't eligible for the requested slot, per ESPN's own
    eligibleSlots for that player (e.g. a kicker into an RB slot)."""


class LineupLockedError(ESPNLineupError):
    """The player's game has already started, by our own best-effort
    check against their scheduled kickoff time (see
    RosterEntry.game_start) — espn_api exposes no explicit "locked" flag,
    so this is inferred, not read directly from ESPN. It may disagree
    with ESPN's actual lock timing at the margins (e.g. a delayed game)."""


class AmbiguousDisplacementError(ESPNLineupError):
    """The destination slot is full and more than one player currently
    occupies a slot with that ID (a league with 2+ RB slots, for
    example) — there's no ESPN-given way to know which one the caller
    means to bench. Callers should use swap_players() with an explicit
    second player instead of guessing."""


class WriteNotVerifiedError(ESPNLineupError):
    """Raised instead of ever sending a lineup mutation to ESPN. The
    write endpoint/method/body is not yet verified against a real
    captured request — see ESPN_LINEUP_WRITE.md. This is the
    guardrail that makes it impossible for set_lineup()/swap_players()
    to accidentally fire an unverified request when dry_run is off."""


class MutationVerificationFailedError(ESPNLineupError):
    """A mutation was actually sent (dry_run=False) but the follow-up
    live roster read didn't show the expected lineup — see Phase 7: an
    HTTP 200 alone is never treated as success."""
