"""add espn player id and pro team to rosters

Player headshots and NFL team logos on every roster/box-score view
(app/providers/espn/adapter.py's Player objects already carry both —
playerId, proTeam — on every sync, just never stored). Both nullable:
the `rosters` table only stores whatever ESPN's live API returned at
sync time, and a full resync of every historical week (2023-2025) may
not be run right away, so existing rows keep player_id/pro_team NULL
until a full resync backfills them — the frontend falls back to an
initials placeholder for those instead of a broken image.

Revision ID: 21d0b5e0ae06
Revises: 893534025217
Create Date: 2026-08-21 04:58:27.184327

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '21d0b5e0ae06'
down_revision: Union[str, Sequence[str], None] = '893534025217'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE rosters ADD COLUMN espn_player_id INTEGER")
    op.execute("ALTER TABLE rosters ADD COLUMN pro_team TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE rosters DROP COLUMN pro_team")
    op.execute("ALTER TABLE rosters DROP COLUMN espn_player_id")
