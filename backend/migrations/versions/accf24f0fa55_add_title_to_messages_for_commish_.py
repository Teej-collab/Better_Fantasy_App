"""add title to messages for Commish's Corner announcements

Commish's Corner (2026-09-04) is getting a redesign: instead of plain
chat bubbles, announcements render as tap-to-expand cards (matching
History's own card list) — which needs a real headline distinct from
the body, chosen explicitly by the commissioner rather than derived
from the text. Nullable, and meaningful only for a message posted into
a commish_corner conversation — every other conversation type
(league, direct) never sets it, same "column exists, most rows leave
it NULL" pattern this app already uses elsewhere (e.g. messages.
image_url itself). No backfill needed: no historical commish_corner
message existed before this feature, so there's nothing to give a
retroactive title to.

Revision ID: accf24f0fa55
Revises: 6ed29b9f0609
Create Date: 2026-09-04 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'accf24f0fa55'
down_revision: Union[str, Sequence[str], None] = '6ed29b9f0609'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE messages ADD COLUMN title TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE messages DROP COLUMN title")
