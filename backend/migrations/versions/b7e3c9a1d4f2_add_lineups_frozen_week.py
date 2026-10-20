"""Next week's lineups open the moment the current week's last game ends

Each team has one live lineup (current_rosters), and until the week
flips (Tuesday 2 PM Central, app/domain/week_flip.py) that live lineup
was also the current week's official one, so every lineup stayed
locked from Monday night to Tuesday afternoon. lineups_frozen_week
records that the current week is over and its roster_history snapshot
is final: the settlement job sets it once every game is final, the
snapshot stops mirroring the live lineup, the week's scores read the
snapshot, and the live lineup becomes next week's
(league_queries.get_lineup_week).

Purely additive: a nullable column, NULL meaning "not frozen", which is
how every week behaved before this.

Revision ID: b7e3c9a1d4f2
Revises: a4c9e1f7b2d5
Create Date: 2026-10-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'b7e3c9a1d4f2'
down_revision: Union[str, Sequence[str], None] = 'a4c9e1f7b2d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE league_state ADD COLUMN lineups_frozen_week INTEGER")


def downgrade() -> None:
    op.execute("ALTER TABLE league_state DROP COLUMN IF EXISTS lineups_frozen_week")
