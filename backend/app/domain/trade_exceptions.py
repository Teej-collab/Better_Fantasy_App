"""Exceptions for app/domain/trades.py — mirrors the shape of
app/domain/lineup_exceptions.py (one class per real failure mode,
mapped to an HTTP status in the router, never a bare generic error)."""


class TradeError(Exception):
    pass


class SameTeamTradeError(TradeError):
    pass


class EmptyTradeError(TradeError):
    pass


class TradeDeadlinePassedError(TradeError):
    pass


class AssetNotOwnedError(TradeError):
    pass


class RosterWouldExceedCapacityError(TradeError):
    pass


class TradeNotFoundError(TradeError):
    pass


class NotYourTradeError(TradeError):
    pass


class TradeNotPendingError(TradeError):
    pass


class TradeNotAwaitingReviewError(TradeError):
    pass
