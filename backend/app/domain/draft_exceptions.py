"""Exceptions for app/domain/draft_engine.py — mirrors the shape of
app/providers/espn/lineup_exceptions.py (one class per real failure
mode, mapped to an HTTP status in app/routers/draft.py, never a bare
generic error the frontend can't distinguish)."""


class DraftError(Exception):
    pass


class DraftNotFoundError(DraftError):
    pass


class DraftAlreadyExistsError(DraftError):
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


class KeeperSelectionsNotLockedError(DraftError):
    """Raised by seed_keepers_from_locked_selections when the season's
    league_keeper_rules.locked_at is still null — keepers must be
    locked (Settings > commissioner keeper rules) before they can be
    seeded into a real draft board, so a still-changeable selection can
    never get baked into draft_picks."""
    pass


class KeeperResolutionError(DraftError):
    """Raised instead of partially seeding: at least one locked
    keeper_selections row couldn't be matched to a real players row via
    the espn_player_id crosswalk (see players.espn_player_id, ~75%
    coverage after this session's crosswalk fix — not every player
    matches). Carries the full list of failures, not just the first,
    so the commissioner can fix everything in one pass."""
    def __init__(self, unresolved: list[dict]):
        self.unresolved = unresolved
        super().__init__(f"{len(unresolved)} keeper selection(s) couldn't be matched to a real player")
