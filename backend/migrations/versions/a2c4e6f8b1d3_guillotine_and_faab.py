"""guillotine eliminations, and FAAB bids on waiver claims

League formats (2026-10):
- guillotine_eliminations: one row per team cut, the week it posted
  the lowest score among the teams still alive. Its players go to
  waivers; the last team left wins.
- waiver_claims.bid_amount: a free-agent budget bid (FAAB). Leagues that
  bid (guillotine) resolve a contested player by the highest bid, then
  waiver priority; a winning bid comes off the team's budget
  (leagues.type_settings.faab_budget minus its winning bids). NULL for
  every claim in a league that doesn't bid — nothing changes there.

Revision ID: a2c4e6f8b1d3
Revises: f1a3c5e7b9d2
Create Date: 2026-10-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a2c4e6f8b1d3'
down_revision: Union[str, Sequence[str], None] = 'f1a3c5e7b9d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE guillotine_eliminations (
            id SERIAL PRIMARY KEY,
            league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            team_id INTEGER NOT NULL REFERENCES teams_by_season(id) ON DELETE CASCADE,
            week_points NUMERIC(10, 2),
            eliminated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (league_id, season, week),
            UNIQUE (team_id)
        )
        """
    )
    op.execute("ALTER TABLE waiver_claims ADD COLUMN bid_amount INTEGER CHECK (bid_amount >= 0)")


def downgrade() -> None:
    op.execute("ALTER TABLE waiver_claims DROP COLUMN bid_amount")
    op.execute("DROP TABLE guillotine_eliminations")
