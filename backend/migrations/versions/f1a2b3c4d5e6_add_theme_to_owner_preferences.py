"""add theme to owner_preferences for the Calm/Cosmic look choice

A signature-look toggle, not a light/dark mode switch — the app stays
dark either way (see globals.css's own "always dark by design" note).
"calm" is today's shipped near-black/flat-panel palette (the default);
"cosmic" restores the earlier starfield-and-nebula, brighter-accent
look as an opt-in per-owner choice rather than reintroducing it
site-wide. Same NOT NULL DEFAULT + CHECK pattern as neon_intensity in
this same table (3da680665fb2) — "missing row == defaults" still holds
via app/queries/owner_preferences.py's get-or-default read.

Revision ID: f1a2b3c4d5e6
Revises: d149bc43c017
Create Date: 2026-09-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'd149bc43c017'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE owner_preferences ADD COLUMN theme TEXT NOT NULL DEFAULT 'calm' "
        "CONSTRAINT owner_preferences_theme_check CHECK (theme IN ('calm', 'cosmic'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE owner_preferences DROP COLUMN theme")
