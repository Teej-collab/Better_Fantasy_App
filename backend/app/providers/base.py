"""
Common interface every fantasy-platform provider implements.

Per MIGRATION_MAP.md: ESPN is the only provider today, but the sync
orchestration and API layer should not need to know that. A future
Yahoo/Sleeper adapter implements the same three methods and nothing
above this layer changes.
"""
from abc import ABC, abstractmethod


class FantasyProvider(ABC):
    @abstractmethod
    async def sync_teams(self, pool, season: int) -> int:
        """Sync teams/owners for one season. Returns rows saved."""

    @abstractmethod
    async def sync_matchups(self, pool, season: int) -> int:
        """Sync weekly matchups/scores for one season. Returns rows saved."""

    @abstractmethod
    async def sync_rosters(self, pool, season: int) -> int:
        """Sync weekly rosters for one season. Returns weeks saved."""

    @abstractmethod
    async def sync_final_standings(self, pool, season: int) -> int:
        """Sync final season ranking for one season. Returns rows saved
        (0 for a season still in progress, not an error)."""

    @abstractmethod
    async def get_current_week(self, season: int) -> int:
        """The provider's own notion of the current week, for live sync
        (see app/providers/sync.py's run_live_sync) — no full history
        scan needed to know what to re-sync."""

    @abstractmethod
    async def sync_matchups_for_week(self, pool, season: int, week: int) -> int:
        """Sync one specific week's matchups/scores. Returns rows saved.
        Unlike sync_matchups, does not scan for "does this week exist" —
        the caller already knows. Meant to be cheap enough to poll
        frequently during live games."""

    @abstractmethod
    async def sync_rosters_for_week(self, pool, season: int, week: int) -> int:
        """Sync one specific week's rosters. Returns 1 if data was saved,
        0 if the provider had nothing for that week. Unlike sync_rosters,
        saves whatever's there even pre-kickoff (0 points scored) — a
        live sync target already knows the week is current, so an empty
        scoreline isn't a signal to skip it, just this week's real state
        (e.g. a lineup set before games lock)."""
