"""watch party rooms: what's on the TV, and its delay

A Lounge (watch party) room shows a live gamecast of the game someone is
sharing — the scorebug, field, plays, and fantasy moments — but the
shared broadcast runs 30-90s behind the live data, so everything about
that game is held back by the room's delay until the TV catches up
(a "TOUCHDOWN" card must never beat the touchdown). The app can't tell
which game a shared screen shows, so whoever's sharing picks it.

- tv_game_id: the ESPN event id of the game on the TV (NULL = nothing).
- tv_delay_seconds: how far behind the live data the TV runs. 45 is a
  typical stream; the room's "Sync to TV" button sets the real number.
- tv_set_by_owner_id / tv_updated_at: who last changed either, and when.

Revision ID: b3e9f2a6c8d1
Revises: a7d3e5c1b9f4
Create Date: 2026-10-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b3e9f2a6c8d1'
down_revision: Union[str, Sequence[str], None] = 'a7d3e5c1b9f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE watch_party_rooms
            ADD COLUMN tv_game_id TEXT,
            ADD COLUMN tv_delay_seconds INTEGER NOT NULL DEFAULT 45 CHECK (tv_delay_seconds BETWEEN 0 AND 180),
            ADD COLUMN tv_set_by_owner_id INTEGER REFERENCES owners(owner_id),
            ADD COLUMN tv_updated_at TIMESTAMPTZ
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE watch_party_rooms
            DROP COLUMN tv_game_id,
            DROP COLUMN tv_delay_seconds,
            DROP COLUMN tv_set_by_owner_id,
            DROP COLUMN tv_updated_at
        """
    )
