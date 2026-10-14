"""add hype_detail to chug_scores

The content-based hype grade's breakdown (app/domain/chug_hype.py):
{self_roast, comedy, commitment, verdict, quote}. Nullable: older chugs
were graded on loudness, and a chug whose grading failed keeps the
neutral hype with no breakdown. Purely additive.

Revision ID: e2b7c9d4f1a6
Revises: b8d0f2a4c6e9
Create Date: 2026-10-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'e2b7c9d4f1a6'
down_revision: Union[str, Sequence[str], None] = 'b8d0f2a4c6e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE chug_scores ADD COLUMN hype_detail JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE chug_scores DROP COLUMN hype_detail")
