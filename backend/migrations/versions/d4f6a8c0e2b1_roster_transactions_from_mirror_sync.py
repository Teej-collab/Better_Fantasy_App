"""roster_transactions from the mirror sync, for league-wide trending

Mirrored ESPN/Sleeper leagues never wrote roster_transactions: their
rosters are copied wholesale every few minutes (mirror_rosters._write),
so an add or drop there left no trace. The mirror sync now compares a
league's rosters before and after each copy and logs the difference
with source 'sync', which feeds both that league's activity feed and the
league-wide Trending page (most added / most dropped across every
league in the app).

The (created_at) index serves Trending's cross-league window scan; the
existing feed index leads with (season, league_id).

Revision ID: d4f6a8c0e2b1
Revises: c8e1a3f5b7d9
Create Date: 2026-11-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd4f6a8c0e2b1'
down_revision: Union[str, Sequence[str], None] = 'c8e1a3f5b7d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE roster_transactions DROP CONSTRAINT roster_transactions_source_check")
    op.execute(
        "ALTER TABLE roster_transactions ADD CONSTRAINT roster_transactions_source_check "
        "CHECK (source IN ('free_agent', 'waiver', 'commissioner', 'sync'))"
    )
    op.execute("CREATE INDEX ix_roster_transactions_created ON roster_transactions (created_at DESC)")


def downgrade() -> None:
    op.execute("DROP INDEX ix_roster_transactions_created")
    op.execute("DELETE FROM roster_transactions WHERE source = 'sync'")
    op.execute("ALTER TABLE roster_transactions DROP CONSTRAINT roster_transactions_source_check")
    op.execute(
        "ALTER TABLE roster_transactions ADD CONSTRAINT roster_transactions_source_check "
        "CHECK (source IN ('free_agent', 'waiver', 'commissioner'))"
    )
