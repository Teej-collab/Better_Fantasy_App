"""add sos to weekly team stats

Strength of schedule (backend/app/domain/weekly_team_stats.py's
compute_sos_for_week): average win percentage of every opponent a team
has faced through a given week, regular season only. Nullable, same as
every other weekly_team_stats column — an existing row with no sos yet
just means a full re-sync hasn't run since this column was added, not
a real gap; run_full_sync (see app/providers/sync.py) backfills it for
every historical week the same way power_rank/luck_score already are.

Revision ID: 18dbc89919aa
Revises: d01d88f0ac00
Create Date: 2026-08-26 08:44:04.123239

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '18dbc89919aa'
down_revision: Union[str, Sequence[str], None] = 'd01d88f0ac00'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE weekly_team_stats ADD COLUMN sos NUMERIC")


def downgrade() -> None:
    op.execute("ALTER TABLE weekly_team_stats DROP COLUMN sos")
