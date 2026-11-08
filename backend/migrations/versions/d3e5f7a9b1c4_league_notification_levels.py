"""per-league notification levels

Settings > Notifications > Your leagues (2026-11-08): for each league,
everything (the default, no row), only what's about your own team, or
muted (no buzz; it still lands in the inbox). Read by app/notifications/
dispatcher.py from the push's own data.league_id.

Revision ID: d3e5f7a9b1c4
Revises: c2d4e6f8a0b3
Create Date: 2026-11-08
"""
from typing import Sequence, Union

from alembic import op

revision: str = "d3e5f7a9b1c4"
down_revision: Union[str, None] = "c2d4e6f8a0b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE league_notification_levels (
            owner_id INTEGER NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
            league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
            level TEXT NOT NULL CHECK (level IN ('mine', 'off')),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (owner_id, league_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE league_notification_levels")
