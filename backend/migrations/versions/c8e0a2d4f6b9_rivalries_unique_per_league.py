"""Rivalries unique per league

A rivalry was unique on the owner pair across every league (the table
predates multi-league), so two people who are rivals in one league
could never be rivals in another. Each league keeps its own now.

Revision ID: c8e0a2d4f6b9
Revises: b7d9f1c3e5a8
Create Date: 2026-10-28 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'c8e0a2d4f6b9'
down_revision: Union[str, Sequence[str], None] = 'b7d9f1c3e5a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE rivalries DROP CONSTRAINT IF EXISTS rivalries_owner_a_id_owner_b_id_key")
    op.execute(
        "ALTER TABLE rivalries ADD CONSTRAINT rivalries_league_owner_pair_key UNIQUE (league_id, owner_a_id, owner_b_id)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE rivalries DROP CONSTRAINT IF EXISTS rivalries_league_owner_pair_key")
    op.execute("ALTER TABLE rivalries ADD CONSTRAINT rivalries_owner_a_id_owner_b_id_key UNIQUE (owner_a_id, owner_b_id)")
