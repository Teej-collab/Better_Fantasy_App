"""watch party rooms: open league parties, and when a room was last used

"Start a watch party" now opens another room the whole league can walk
into (kind 'party') — alongside the always-open League Lounge ('open',
one per league) and invite-only rooms ('private'). Any number of parties
can run at once, each with its own TV and chat.

- kind: adds 'party'.
- last_active_at: bumped whenever someone joins; an empty party closes
  itself once its game is over or it's sat idle (app/domain/
  watch_party_rooms.py's sweep).

Revision ID: e8b4d1f7a2c6
Revises: d7a2c9e4f1b8
Create Date: 2026-10-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e8b4d1f7a2c6'
down_revision: Union[str, Sequence[str], None] = 'd7a2c9e4f1b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE watch_party_rooms
            DROP CONSTRAINT watch_party_rooms_kind_check,
            ADD CONSTRAINT watch_party_rooms_kind_check CHECK (kind IN ('open', 'private', 'party')),
            ADD COLUMN last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM watch_party_rooms WHERE kind = 'party'")
    op.execute(
        """
        ALTER TABLE watch_party_rooms
            DROP COLUMN last_active_at,
            DROP CONSTRAINT watch_party_rooms_kind_check,
            ADD CONSTRAINT watch_party_rooms_kind_check CHECK (kind IN ('open', 'private'))
        """
    )
