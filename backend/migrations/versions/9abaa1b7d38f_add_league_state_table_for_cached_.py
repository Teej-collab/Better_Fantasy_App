"""add league_state table for cached current week

Phase 7: the Team page should default to the current week, not a
hardcoded week=1. "Current week" only has one real source — ESPN's own
League.current_week (already ported as ESPNProvider.get_current_week) —
but calling that live on every page view would mean hitting ESPN's
unofficial API on every visit, which is both wasteful and risky (see
ARCHITECTURE.md's fragility warning). Instead, cache it here, refreshed
as a side effect of syncs that are already happening (full or live) —
zero extra ESPN calls beyond what's already made.

Revision ID: 9abaa1b7d38f
Revises: 0528c1f9a3cb
Create Date: 2026-08-19 12:55:47.924640

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '9abaa1b7d38f'
down_revision: Union[str, Sequence[str], None] = '0528c1f9a3cb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE league_state (
            season          INT PRIMARY KEY,
            current_week    INT NOT NULL,
            updated_at      TIMESTAMPTZ DEFAULT now()
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE league_state")
