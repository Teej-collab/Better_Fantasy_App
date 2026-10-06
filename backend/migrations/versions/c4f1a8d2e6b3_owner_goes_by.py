"""owners: the name the league calls them

The weekly recap names every manager the way the league actually talks
about them (2026-10, the commissioner's call) — "Jimmy", "Bo" — instead
of their team name. goes_by holds that name when it isn't simply the
first word of display_name; NULL means use the first name.

Revision ID: c4f1a8d2e6b3
Revises: b3e9f2a6c8d1
Create Date: 2026-10-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c4f1a8d2e6b3'
down_revision: Union[str, Sequence[str], None] = 'b3e9f2a6c8d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE owners ADD COLUMN goes_by TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE owners DROP COLUMN goes_by")
