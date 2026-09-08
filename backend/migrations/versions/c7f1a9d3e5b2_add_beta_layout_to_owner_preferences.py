"""add beta_layout to owner_preferences for the opt-in "Try the new
look" toggle (Settings > Labs)

Gates the redesigned nav (Home/League/Matchup/Chat/More) and page
layouts proposed in Documentation/UX/ — orthogonal to `theme`
(Calm/Cosmic is a palette choice; this is a structural one, see
Documentation/UX/06_Implementation_Roadmap.md section 0 for the full
rollout reasoning). Same NOT NULL DEFAULT pattern as theme
(f1a2b3c4d5e6) in this same table — "missing row == defaults" still
holds via app/queries/owner_preferences.py's get-or-default read.
Defaults to false: this is a beta a visitor opts into, not a
site-wide flip.

Revision ID: c7f1a9d3e5b2
Revises: 8b295d67654f
Create Date: 2026-09-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c7f1a9d3e5b2'
down_revision: Union[str, Sequence[str], None] = '8b295d67654f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE owner_preferences ADD COLUMN beta_layout BOOLEAN NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE owner_preferences DROP COLUMN beta_layout")
