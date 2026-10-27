"""Draft grades by starting-lineup value and pick value

Grades used to rank teams by the total projected points of every player
they drafted, so a team that took four QBs graded well on points it
could never start. app/domain/draft_grades.py now ranks by value over
replacement in the best lineup the roster can start, plus a little for
real bench depth.

- starter_projected_points: projected points of that best lineup, the
  number the app shows next to the grade.
- league_avg_starter_projected_points: the league average of the same.
- value_score: the lineup value the grade ranks on.
- pick_value_rounds: average rounds gained per non-keeper pick against
  the league's own value board (NULL for an auction).

All nullable: grades computed before this keep their old numbers until
they're computed again.

Revision ID: c2e4a6b8d0f3
Revises: b8d2f4a6c3e1
Create Date: 2026-10-27 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'c2e4a6b8d0f3'
down_revision: Union[str, Sequence[str], None] = 'b8d2f4a6c3e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE draft_grades ADD COLUMN starter_projected_points NUMERIC")
    op.execute("ALTER TABLE draft_grades ADD COLUMN league_avg_starter_projected_points NUMERIC")
    op.execute("ALTER TABLE draft_grades ADD COLUMN value_score NUMERIC")
    op.execute("ALTER TABLE draft_grades ADD COLUMN pick_value_rounds NUMERIC")


def downgrade() -> None:
    op.execute("ALTER TABLE draft_grades DROP COLUMN IF EXISTS pick_value_rounds")
    op.execute("ALTER TABLE draft_grades DROP COLUMN IF EXISTS value_score")
    op.execute("ALTER TABLE draft_grades DROP COLUMN IF EXISTS league_avg_starter_projected_points")
    op.execute("ALTER TABLE draft_grades DROP COLUMN IF EXISTS starter_projected_points")
