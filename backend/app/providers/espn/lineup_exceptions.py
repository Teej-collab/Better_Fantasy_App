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


class PlayerAlreadyRosteredError(ESPNLineupError):
    """The player being added is already on this team's roster — adding
    them again isn't a real operation, unlike a lineup move."""


class RosterFullError(ESPNLineupError):
    """The roster is already at its full configured size (every real
    slot, starting and bench, counted — see
    ESPNLineupClient._roster_capacity) and no player to drop was given.
    Distinct from every other planning error: it isn't a dead end, it's
    a real decision the caller needs to make — the mapped HTTP status
    (409) tells the frontend to prompt for a drop rather than just
    showing a plain error."""


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


class ESPNWriteTimeoutError(ESPNLineupError):
    """The write request timed out. Phase 7's specific warning applies:
    ESPN may have accepted the mutation before the timeout fired, so
    retrying blindly could double-apply it (e.g. re-swapping two players
    back to where they started). Callers must call verify_lineup() to
    find out what actually happened before doing anything else — never
    just retry."""


class ESPNWriteHTTPError(ESPNLineupError):
    """ESPN's write endpoint returned a non-2xx status. Carries the
    status code and a bounded snippet of the response body (no
    credentials are ever in this response — it's the user's own
    transaction record) for debugging."""

    def __init__(self, status_code: int, body_snippet: str):
        self.status_code = status_code
        self.body_snippet = body_snippet
        super().__init__(f"ESPN write request failed: HTTP {status_code} — {body_snippet}")


class ESPNWriteMalformedResponseError(ESPNLineupError):
    """ESPN returned a 2xx but the body wasn't valid JSON, or didn't
    contain the fields the 2026-08-19 verified capture showed
    (specifically `status`) — see ESPN_LINEUP_WRITE.md. Treated as a
    failure rather than guessing at what happened, per Phase 7."""
