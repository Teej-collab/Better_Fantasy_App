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
