"""add projected_avg_points to players for per-week matchup projections

Nullable, same "display enrichment, not load-bearing" shape as
projected_points (a3c7e2f9b1d4). Filled by the same ESPN bulk sync
(app/domain/player_projections.py), but sourced via League.player_info
now instead of League.free_agents() — free_agents() only returns
players NOT rostered on ESPN's OWN (now-irrelevant) league, which
excludes exactly the real stars this league's owners actually drafted
in-app (2026-09, real incident: Mahomes/McCaffrey/Bowers/Metcalf all
showed projected_points=NULL despite a real projections sync having
just run, because ESPN's own stale league had already auto-rostered
them elsewhere). player_info(playerId=[...]) works regardless of
ESPN-side roster status, so this also refreshes projected_points
(season total) more completely than before.

projected_avg_points is ESPN's own per-game average across the
season — the best available stand-in for "this week's projection"
before ESPN publishes real week-specific numbers (which its player
data doesn't expose pre-season — empirically confirmed).

Revision ID: 761a416f35f7
Revises: de2815ccf477
Create Date: 2026-09-07 08:18:52.929064

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '761a416f35f7'
down_revision: Union[str, Sequence[str], None] = 'de2815ccf477'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE players ADD COLUMN projected_avg_points NUMERIC")


def downgrade() -> None:
    op.execute("ALTER TABLE players DROP COLUMN projected_avg_points")
