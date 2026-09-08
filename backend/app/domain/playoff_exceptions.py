"""Exceptions for app/domain/playoffs.py — one class per real failure
mode, same discipline as app/domain/lineup_exceptions.py and app/
domain/waiver_exceptions.py."""


class PlayoffError(Exception):
    pass


class PlayoffAlreadyGeneratedError(PlayoffError):
    """A bracket already exists for this (season, league_id) — generating
    again would silently orphan any real, already-scheduled playoff
    matchups rather than protect them."""

    pass


class PlayoffTeamCountUnknownError(PlayoffError):
    """No commissioner-set playoff_team_count and no prior season's
    real playoff data to infer one from — see get_playoff_team_count's
    own docstring for the fallback chain this exhausted."""

    pass


class UnsupportedPlayoffTeamCountError(PlayoffError):
    """This bracket engine only supports a single-elimination bracket
    with no byes — playoff_team_count must be a power of 2 (2, 4, 8,
    ...). A non-power-of-2 count (byes for the top seeds) is a real
    gap, deliberately out of scope for this first version — see this
    module's own docstring."""

    pass


class RegularSeasonNotStartedError(PlayoffError):
    """No regular-season matchups exist yet for this season/league, so
    there's nothing to infer a playoff start_week from and no
    standings to seed a bracket from."""

    pass
