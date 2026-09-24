"""add roast to chug_scores

A short AI trash-talk write-up for each graded chug (app/domain/
chug_roast.py), generated right after the chug is recorded. Nullable:
older chugs, and any chug whose write-up failed or timed out, simply
have none. Purely additive.

Revision ID: d7a3f1c8e5b2
Revises: c4d1e7a9b2f3
Create Date: 2026-09-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'd7a3f1c8e5b2'
down_revision: Union[str, Sequence[str], None] = 'c4d1e7a9b2f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE chug_scores ADD COLUMN roast TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE chug_scores DROP COLUMN roast")
