"""Matchup headlines

app/domain/schedule_builder.py marks a schedule's marquee games — the
Season Opener, Rivalry Week games, a Championship Rematch — so the app
can show them. NULL for every ordinary game and every synced one.

Revision ID: f5b7d9e1a3c6
Revises: e4a6c8d0f2b5
Create Date: 2026-10-27 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'f5b7d9e1a3c6'
down_revision: Union[str, Sequence[str], None] = 'e4a6c8d0f2b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE matchups ADD COLUMN headline TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE matchups DROP COLUMN IF EXISTS headline")
