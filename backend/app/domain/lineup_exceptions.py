"""Exceptions for app/domain/lineup_engine.py — the in-app roster/
lineup engine that replaced ESPNLineupClient for this purpose (see the
project plan's Phase C). Mirrors the shape of
app/providers/espn/lineup_exceptions.py (one class per real failure
mode, mapped to an HTTP status in the router, never a bare generic
error) but scoped to what's actually possible against our own DB — no
HTTP/timeout/write-verification classes, since there's no external
write to fail."""


class LineupError(Exception):
    pass


class PlayerNotOnRosterError(LineupError):
    pass


class SlotIneligibleError(LineupError):
    pass


class AmbiguousDisplacementError(LineupError):
    pass


class RosterConfigNotFoundError(LineupError):
    pass


class PlayerNotDraftableError(LineupError):
    pass


class PlayerAlreadyRosteredError(LineupError):
    pass


class RosterFullError(LineupError):
    pass


class PlayerOnWaiversError(LineupError):
    """Raised by add_free_agent when the target player is still within
    this league's real waiver period (app/domain/waivers.py) — they
    were dropped too recently to be instantly addable; the caller has
    to submit a waiver claim instead (POST /me/team/waivers/claim)."""

    pass


class LineupLockedError(LineupError):
    """Raised when a move/swap would touch a player whose real NFL game
    has already kicked off this week — mirrors app/providers/espn/
    lineup_exceptions.py's class of the same name, the retired ESPN-
    backed lineup client's own per-player kickoff lock. This app's
    in-app lineup engine had no equivalent until now (a confirmed real
    gap: a manager could start or bench a player after their game
    ended, with zero backend enforcement)."""

    pass


class IRSlotViolationError(LineupError):
    """A player in this team's IR slot is no longer IR-eligible — no
    adds until they're moved off IR (see app/domain/ir_rules.py)."""

    pass
