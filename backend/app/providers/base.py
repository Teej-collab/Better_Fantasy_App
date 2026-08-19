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
