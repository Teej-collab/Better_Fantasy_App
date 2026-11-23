"""Owners Box color themes

owner_preferences.ob_palette (2026-11-23): the Owners Box look gets the
Weekend looks' palettes (Night is the one it shipped with), picked in
Settings > Look & feel > Color theme.

Revision ID: d2e4f6a8b0c1
Revises: c1d3e5f7a9b0
Create Date: 2026-11-23
"""
from alembic import op

revision = "d2e4f6a8b0c1"
down_revision = "c1d3e5f7a9b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE owner_preferences ADD COLUMN ob_palette TEXT NOT NULL DEFAULT 'night' "
        "CHECK (ob_palette IN ('night', 'cosmic', 'midnight', 'graphite', 'ember', 'gridiron'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE owner_preferences DROP COLUMN ob_palette")
