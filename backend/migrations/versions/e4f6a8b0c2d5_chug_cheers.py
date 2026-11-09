"""chug cheers

A "Cheers" on a posted chug (2026-11-09): we watched it, we liked it.
One per owner per chug; app/routers/chug.py's POST /chug/{id}/cheers
toggles it and GET /chug/feed carries the count and who.

Revision ID: e4f6a8b0c2d5
Revises: d3e5f7a9b1c4
Create Date: 2026-11-09
"""
from typing import Sequence, Union

from alembic import op

revision: str = "e4f6a8b0c2d5"
down_revision: Union[str, None] = "d3e5f7a9b1c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE chug_cheers (
            chug_id INTEGER NOT NULL REFERENCES chug_scores(id) ON DELETE CASCADE,
            owner_id INTEGER NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (chug_id, owner_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE chug_cheers")
