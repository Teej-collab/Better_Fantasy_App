"""add honeycomb_color to owner_preferences

The color of the breathing honeycomb background behind every page
(frontend/src/components/CinematicHoneycombBackground.tsx). Nullable —
NULL means the app default (crimson), same "missing == default"
discipline as accent_color. Besides a 6-digit hex, the literal "off"
hides the background entirely.

Revision ID: a7c3e9f1d4b6
Revises: f3a9c1e5b7d2
Create Date: 2026-09-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a7c3e9f1d4b6'
down_revision: Union[str, Sequence[str], None] = 'f3a9c1e5b7d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE owner_preferences ADD COLUMN honeycomb_color TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE owner_preferences DROP COLUMN honeycomb_color")
