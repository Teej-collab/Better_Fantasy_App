"""Exceptions for app/domain/schedule.py — one class per real failure
mode, same discipline as this app's other domain exception modules
(lineup_exceptions.py, waiver_exceptions.py, playoff_exceptions.py)."""


class ScheduleError(Exception):
    pass


class ScheduleAlreadyExistsError(ScheduleError):
    """Regular-season matchups already exist for this (season, league_id)
    — generating again would silently orphan any already-scheduled (or
    already-played) games rather than protect them. Regenerating a real
    schedule is a deliberate, destructive action a commissioner should
    take through a real "delete the existing schedule first" step, not
    something this function does implicitly."""

    pass


class NotEnoughTeamsError(ScheduleError):
    """Fewer than 2 real teams exist for this season/league — nothing to
    pair into a schedule."""

    pass
