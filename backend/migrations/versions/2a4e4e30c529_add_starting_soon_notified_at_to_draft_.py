"""add starting soon notified at to draft config

New "draft starting soon" push reminder (app/notifications/
draft_events.py, app/scheduler.py's draft-clock scheduler) needs a
one-time idempotency flag — unlike the existing keeper auto-lock job
(idempotent via locked_at already being a real state change), sending
a push has no natural "already done" marker of its own, so this column
is that marker. Nullable, set once the reminder actually goes out;
NULL means "not sent yet". No backfill: only ever meaningful for a
draft that hasn't started yet, and every existing draft_config row is
either already in progress or complete.

Revision ID: 2a4e4e30c529
Revises: accf24f0fa55
Create Date: 2026-09-04 13:09:08.390382

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '2a4e4e30c529'
down_revision: Union[str, Sequence[str], None] = 'accf24f0fa55'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE draft_config ADD COLUMN starting_soon_notified_at TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE draft_config DROP COLUMN starting_soon_notified_at")
