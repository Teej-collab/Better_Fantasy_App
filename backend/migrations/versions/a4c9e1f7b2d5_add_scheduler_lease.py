"""Scheduler lease: one backend copy runs the scheduled jobs

Every job in app/scheduler.py assumes it's the only one running it —
two copies of the backend (a Railway replica bumped to 2, or a deploy
whose old and new containers overlap) would both settle the week, both
process waivers and both send every push. A Postgres advisory lock
can't guard that here: DATABASE_URL goes through Supabase's
transaction-mode pooler, which hands each statement whatever server
connection is free, so a session lock is held by nobody in particular.
Instead, one row per lease names the copy holding it and when that
claim runs out; the holder renews it every few seconds
(app/scheduler_lease.py).

Purely additive: no existing table changes.

Revision ID: a4c9e1f7b2d5
Revises: e2b8d4f6a1c3
Create Date: 2026-10-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'a4c9e1f7b2d5'
down_revision: Union[str, Sequence[str], None] = 'e2b8d4f6a1c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE scheduler_lease (
            name TEXT PRIMARY KEY,
            holder TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS scheduler_lease")
