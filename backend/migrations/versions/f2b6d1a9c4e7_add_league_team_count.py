"""add leagues.team_count

How many teams a league is meant to have, picked when it's created
(the Create a League flow's "How many teams?"). Drives the invite
screen's "1 / 12 teams in" progress and the join preview. NULL for
leagues made before it existed — nothing requires it.

Revision ID: f2b6d1a9c4e7
Revises: e9c4a1b7d3f2
Create Date: 2026-10-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f2b6d1a9c4e7'
down_revision: Union[str, Sequence[str], None] = 'e9c4a1b7d3f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE leagues ADD COLUMN team_count INTEGER CHECK (team_count BETWEEN 2 AND 32)")


def downgrade() -> None:
    op.execute("ALTER TABLE leagues DROP COLUMN team_count")
