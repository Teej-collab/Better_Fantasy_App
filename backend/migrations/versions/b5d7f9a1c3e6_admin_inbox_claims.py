"""Admin inbox claims

The admin inbox (2026-10-28) gathers what needs a person (new errors,
crashes, feedback, waitlist sign-ups, ask-to-join requests, new
leagues) into one feed for the site admins. This table holds who has
claimed an item, so two admins don't both chase it, and when it was
marked done. An item is (kind, ref): its source and that source's own
id, so nothing is copied out of the source tables.

Revision ID: b5d7f9a1c3e6
Revises: a3c5e7f9b1d2
Create Date: 2026-10-28 23:30:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'b5d7f9a1c3e6'
down_revision: Union[str, Sequence[str], None] = 'a3c5e7f9b1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE admin_inbox_claims (
            kind        TEXT NOT NULL,
            ref         TEXT NOT NULL,
            claimed_by  INT REFERENCES users(id) ON DELETE SET NULL,
            claimed_at  TIMESTAMPTZ,
            done_by     INT REFERENCES users(id) ON DELETE SET NULL,
            done_at     TIMESTAMPTZ,
            PRIMARY KEY (kind, ref)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE admin_inbox_claims")
