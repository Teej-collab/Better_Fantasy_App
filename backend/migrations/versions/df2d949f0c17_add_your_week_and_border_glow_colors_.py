"""add your_week_color and border_glow_color to owner_preferences

Nullable — NULL means "fall back to accent_color, then the app default,"
same "missing == default" discipline as accent_color itself (migration
4254e9a81de3). Two independent personal color choices, on top of the
existing general Accent Color:

- your_week_color: just the Home page's "Your Week" hero card (label,
  CTA, background/border tint) — frontend/src/app/(home)/page.tsx's
  YourWeekHero/EmptyHero.
- border_glow_color: the moving neon ring on every card and countdown
  tile (globals.css's --ring-color) — independent of what tints the
  card itself, so an owner can have a gold Your Week card with a pink
  ring, or any other combination.

Revision ID: df2d949f0c17
Revises: 5daa8c6a9e14
Create Date: 2026-09-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'df2d949f0c17'
down_revision: Union[str, Sequence[str], None] = '5daa8c6a9e14'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE owner_preferences ADD COLUMN your_week_color TEXT")
    op.execute("ALTER TABLE owner_preferences ADD COLUMN border_glow_color TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE owner_preferences DROP COLUMN your_week_color")
    op.execute("ALTER TABLE owner_preferences DROP COLUMN border_glow_color")
