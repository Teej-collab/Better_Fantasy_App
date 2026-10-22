"""NFL scoreboard snapshots: the last good ESPN answer per request

On 2026-10-22 ESPN started answering every scoreboard request from
Railway with 403 Forbidden while the same request from anywhere else
still worked. Nearly every page reads the scoreboard (your week,
standings, recaps, awards, matchups, playoff odds), so the whole app
went down with it. app/providers/nfl_scoreboard.py now keeps each
request's last good answer here and serves it when ESPN fails, so an
ESPN outage costs fresh scores, not the app. A table rather than the
process's own memory because a deploy restarts the process.

Purely additive: no existing table changes.

Revision ID: c3f1a7d9e5b2
Revises: b7e3c9a1d4f2
Create Date: 2026-10-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'c3f1a7d9e5b2'
down_revision: Union[str, Sequence[str], None] = 'b7e3c9a1d4f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE nfl_scoreboard_snapshots (
            cache_key TEXT PRIMARY KEY,
            payload JSONB NOT NULL,
            fetched_at TIMESTAMPTZ NOT NULL
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS nfl_scoreboard_snapshots")
