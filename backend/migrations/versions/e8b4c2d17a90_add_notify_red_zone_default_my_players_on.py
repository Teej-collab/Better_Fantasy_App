"""add notify_red_zone and default notify_my_players on

Adds the red zone alert preference (on by default) and turns
touchdown alerts (notify_my_players) on for everyone, now and by
default. Every owner who ever enabled push had a preferences row
written with notify_my_players = FALSE from the old default, whether
they chose it or not, so the backfill is what actually turns
touchdown alerts on for them (commissioner's call, 2026-09-26). The
downgrade restores the old default but can't know who had it off
before, so it leaves existing values alone.

Revision ID: e8b4c2d17a90
Revises: 0abe0690feb3
Create Date: 2026-09-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'e8b4c2d17a90'
down_revision: Union[str, Sequence[str], None] = '0abe0690feb3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE owner_preferences ADD COLUMN notify_red_zone BOOLEAN NOT NULL DEFAULT TRUE")
    op.execute("ALTER TABLE owner_preferences ALTER COLUMN notify_my_players SET DEFAULT TRUE")
    op.execute("UPDATE owner_preferences SET notify_my_players = TRUE WHERE notify_my_players = FALSE")


def downgrade() -> None:
    op.execute("ALTER TABLE owner_preferences ALTER COLUMN notify_my_players SET DEFAULT FALSE")
    op.execute("ALTER TABLE owner_preferences DROP COLUMN notify_red_zone")
