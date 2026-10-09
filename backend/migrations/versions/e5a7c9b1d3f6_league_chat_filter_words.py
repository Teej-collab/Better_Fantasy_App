"""league chat filter words

Revision ID: e5a7c9b1d3f6
Revises: d4f6a8c0e2b5
Create Date: 2026-10-09

The chat filter (app/moderation.py) masks a built-in list of slurs
everywhere; a commissioner can add their own words for their league here.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'e5a7c9b1d3f6'
down_revision: Union[str, Sequence[str], None] = 'd4f6a8c0e2b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE league_chat_filter_words (
            league_id   INT PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
            words       TEXT[] NOT NULL DEFAULT '{}',
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE league_chat_filter_words")
