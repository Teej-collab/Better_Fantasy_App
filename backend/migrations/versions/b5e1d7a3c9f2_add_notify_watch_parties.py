"""add notify_watch_parties to owner_preferences

Push when someone in your league starts an open watch party, or invites
you to a private room (app/notifications/watch_party_events.py). Its own
switch rather than riding on notify_league ("League Activity"), so
someone can keep chug and trade alerts but mute party pings. On by
default, like the other league alerts. Purely additive.

Revision ID: b5e1d7a3c9f2
Revises: a4d9e6c2f8b1
Create Date: 2026-10-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'b5e1d7a3c9f2'
down_revision: Union[str, Sequence[str], None] = 'a4d9e6c2f8b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE owner_preferences ADD COLUMN notify_watch_parties BOOLEAN NOT NULL DEFAULT TRUE")


def downgrade() -> None:
    op.execute("ALTER TABLE owner_preferences DROP COLUMN notify_watch_parties")
