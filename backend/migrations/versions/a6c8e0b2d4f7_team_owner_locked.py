"""Teams whose owner was set by hand

One ESPN (or Sleeper) login can run more than one team in a league: a
family league where one account manages two teams, say. The sync maps
every team to the account that runs it, so both land on that one person.
When they say which team is theirs, the other team gets its own owner
for the real manager to claim, and owner_locked keeps the sync from
handing it back on its next run (the same idea as team_name_is_custom).

Revision ID: a6c8e0b2d4f7
Revises: f5b7d9e1a3c6
Create Date: 2026-10-28 03:30:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'a6c8e0b2d4f7'
down_revision: Union[str, Sequence[str], None] = 'f5b7d9e1a3c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE teams_by_season ADD COLUMN owner_locked BOOLEAN NOT NULL DEFAULT FALSE")


def downgrade() -> None:
    op.execute("ALTER TABLE teams_by_season DROP COLUMN IF EXISTS owner_locked")
