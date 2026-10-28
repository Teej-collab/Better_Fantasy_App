"""Four more looks: midnight, graphite, ember, gridiron

owner_preferences.theme was Calm or Cosmic; each new look is a full
palette of its own (2026-10-28, the approved "The Weekend Themes"
mockup; mobile constants/theme.ts and web globals.css).

Revision ID: f2b4d6e8a0c1
Revises: e1a3c5d7f9b2
Create Date: 2026-10-28 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'f2b4d6e8a0c1'
down_revision: Union[str, Sequence[str], None] = 'e1a3c5d7f9b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE owner_preferences DROP CONSTRAINT IF EXISTS owner_preferences_theme_check")
    op.execute(
        "ALTER TABLE owner_preferences ADD CONSTRAINT owner_preferences_theme_check "
        "CHECK (theme IN ('calm', 'cosmic', 'midnight', 'graphite', 'ember', 'gridiron'))"
    )


def downgrade() -> None:
    op.execute("UPDATE owner_preferences SET theme = 'calm' WHERE theme NOT IN ('calm', 'cosmic')")
    op.execute("ALTER TABLE owner_preferences DROP CONSTRAINT IF EXISTS owner_preferences_theme_check")
    op.execute("ALTER TABLE owner_preferences ADD CONSTRAINT owner_preferences_theme_check CHECK (theme IN ('calm', 'cosmic'))")
