"""notification_once — pushes that must go out exactly once

Waiver results, matchup finals, pre-kickoff lineup alerts and close-game
alerts (2026-10) are each sent once per thing they're about; this table
records the key the first time so a retried job or a scheduler restart
never sends a second copy.

Revision ID: c3d5f7a9b1e4
Revises: b2c4e6a8d0f1
Create Date: 2026-10-07 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c3d5f7a9b1e4'
down_revision: Union[str, Sequence[str], None] = 'b2c4e6a8d0f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE notification_once (
            key      TEXT PRIMARY KEY,
            sent_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE notification_once")
