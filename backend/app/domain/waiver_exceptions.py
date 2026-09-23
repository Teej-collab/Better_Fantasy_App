"""Exceptions for app/domain/waivers.py — one class per real failure
mode, same discipline as app/domain/lineup_exceptions.py (never a bare
generic error, always mapped to a specific HTTP status in the router).
PlayerOnWaiversError itself lives in lineup_exceptions.py, not here —
it's raised by add_free_agent (the instant-add path rejecting a still-
waived player), not by anything in this module."""


class WaiverError(Exception):
    pass


class PlayerNotOnWaiversError(WaiverError):
    """Raised when a claim targets a player who isn't actually on
    waivers right now — either never dropped, or their waiver period
    already cleared. The caller should use the normal instant
    add-free-agent flow instead."""

    pass


class DuplicateClaimError(WaiverError):
    """This team already has a pending claim on this exact player —
    matches waiver_claims' own partial unique index rather than
    relying on the DB error to surface a clean message."""

    pass


class ClaimNotFoundError(WaiverError):
    pass


class ClaimNotCancellableError(WaiverError):
    """The claim has already been processed (successful/failed) —
    nothing left to cancel."""

    pass


class IRSlotViolationClaimError(WaiverError):
    """A player in this team's IR slot is no longer IR-eligible — no
    claims until they're moved off IR (see app/domain/ir_rules.py)."""

    pass
