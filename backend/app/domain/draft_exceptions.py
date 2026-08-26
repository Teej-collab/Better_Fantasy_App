"""Exceptions for app/domain/draft_engine.py — mirrors the shape of
app/providers/espn/lineup_exceptions.py (one class per real failure
mode, mapped to an HTTP status in app/routers/draft.py, never a bare
generic error the frontend can't distinguish)."""


class DraftError(Exception):
    pass


class DraftNotFoundError(DraftError):
    pass


class DraftNotInProgressError(DraftError):
    pass


class NotYourTurnError(DraftError):
    pass


class PlayerNotDraftableError(DraftError):
    pass


class PlayerAlreadyDraftedError(DraftError):
    pass


class NothingToUndoError(DraftError):
    pass
