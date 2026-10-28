"""One copy per outside league

An ESPN or Sleeper league can be connected to only one league on The
Weekend (2026-10-28): a second person bringing it in joins that one
instead of splitting the league in two. If two leagues already share
one, this stops and names them, so they can be merged by hand first.

Revision ID: a3c5e7f9b1d2
Revises: f2b4d6e8a0c1
Create Date: 2026-10-28 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = 'a3c5e7f9b1d2'
down_revision: Union[str, Sequence[str], None] = 'f2b4d6e8a0c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    for table, column in (("league_espn_connections", "espn_league_id"), ("league_sleeper_connections", "sleeper_league_id")):
        dupes = bind.execute(text(
            f"SELECT {column}, array_agg(league_id ORDER BY league_id) FROM {table} GROUP BY {column} HAVING count(*) > 1"
        )).fetchall()
        if dupes:
            listed = "; ".join(f"{row[0]} is connected to leagues {list(row[1])}" for row in dupes)
            raise RuntimeError(f"{table}: one outside league is in more than one league already ({listed}). Merge or disconnect them first.")
    op.execute("CREATE UNIQUE INDEX league_espn_connections_espn_league_id_key ON league_espn_connections (espn_league_id)")
    op.execute("CREATE UNIQUE INDEX league_sleeper_connections_sleeper_league_id_key ON league_sleeper_connections (sleeper_league_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS league_sleeper_connections_sleeper_league_id_key")
    op.execute("DROP INDEX IF EXISTS league_espn_connections_espn_league_id_key")
