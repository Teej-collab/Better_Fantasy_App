"""add position_max roster cap to draft_config and roster slots settings

Revision ID: ed4c14eb48c4
Revises: 9362b3ac968e
Create Date: 2026-09-05 07:21:23.735103

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ed4c14eb48c4'
down_revision: Union[str, Sequence[str], None] = '9362b3ac968e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable on both tables — None means "no configured caps, fall
    # back to draft_autopick.py's existing physical-capacity guardrail"
    # (own starter slot + flex allowance + full bench), so every
    # existing league/season keeps behaving exactly as it does today
    # until a commissioner actually sets real values. Lives alongside
    # roster_slots on the same two tables (staged league_roster_slots_
    # settings pre-draft, snapshotted onto draft_config once a real
    # draft exists) since it's config for the same "how many of X can
    # this team have" concern, just capping raw position count instead
    # of starter-slot count.
    op.execute("ALTER TABLE draft_config ADD COLUMN position_max JSONB")
    op.execute("ALTER TABLE league_roster_slots_settings ADD COLUMN position_max JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE league_roster_slots_settings DROP COLUMN position_max")
    op.execute("ALTER TABLE draft_config DROP COLUMN position_max")
