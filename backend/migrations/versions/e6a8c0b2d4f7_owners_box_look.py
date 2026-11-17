"""The Owners Box look

owner_preferences.theme gains 'ownersbox' (2026-11-17): a seventh Look in
Settings that switches the phone app to the Owners Box design (mobile
components/ob/). The web shows Calm for it.

Revision ID: e6a8c0b2d4f7
Revises: d3f5a7c9e1b4
Create Date: 2026-11-17 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'e6a8c0b2d4f7'
down_revision: Union[str, Sequence[str], None] = 'd3f5a7c9e1b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE owner_preferences DROP CONSTRAINT IF EXISTS owner_preferences_theme_check")
    op.execute(
        "ALTER TABLE owner_preferences ADD CONSTRAINT owner_preferences_theme_check "
        "CHECK (theme IN ('calm', 'cosmic', 'midnight', 'graphite', 'ember', 'gridiron', 'ownersbox'))"
    )


def downgrade() -> None:
    op.execute("UPDATE owner_preferences SET theme = 'calm' WHERE theme = 'ownersbox'")
    op.execute("ALTER TABLE owner_preferences DROP CONSTRAINT IF EXISTS owner_preferences_theme_check")
    op.execute(
        "ALTER TABLE owner_preferences ADD CONSTRAINT owner_preferences_theme_check "
        "CHECK (theme IN ('calm', 'cosmic', 'midnight', 'graphite', 'ember', 'gridiron'))"
    )
