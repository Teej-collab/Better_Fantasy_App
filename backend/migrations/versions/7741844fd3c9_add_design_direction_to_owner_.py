"""add design_direction to owner_preferences for the Labs redesign picker

A second, independent visual-identity axis alongside theme
(f1a2b3c4d5e6): theme swaps 5 palette tokens (Calm/Cosmic), this swaps
the app's full color system AND typography for two opt-in redesign
directions built from a real design-exploration pass ("Broadcast Desk"
and "Stadium Lights") — see /design-exploration in the repo root for
the source mockups. "default" (today's shipped look) is the default,
matching every other Labs-style opt-in in this table. Same NOT NULL
DEFAULT + CHECK pattern as theme itself.

Deliberately its own column rather than repurposing beta_layout:
beta_layout gates structure (which nav/page components render, see
NavBar.tsx), this gates palette + typography only — same
orthogonality theme already has to beta_layout, just a bigger set of
tokens changing together. The frontend additionally disables the
Calm/Cosmic theme picker whenever design_direction != "default"
(AppearanceSection.tsx) to avoid an owner combining two independent
palette choices into an undefined-looking state — enforced in the UI,
not here, so this column has no CHECK referencing theme.

Revision ID: 7741844fd3c9
Revises: cda4f0235dde
Create Date: 2026-09-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '7741844fd3c9'
down_revision: Union[str, Sequence[str], None] = 'cda4f0235dde'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE owner_preferences ADD COLUMN design_direction TEXT NOT NULL DEFAULT 'default' "
        "CONSTRAINT owner_preferences_design_direction_check "
        "CHECK (design_direction IN ('default', 'broadcast', 'stadium'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE owner_preferences DROP COLUMN design_direction")
