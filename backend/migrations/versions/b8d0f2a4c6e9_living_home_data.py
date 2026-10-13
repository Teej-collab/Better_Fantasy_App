"""living home data: practice reports and win-% snapshots

Revision ID: b8d0f2a4c6e9
Revises: a7c9e1b3d5f7
Create Date: 2026-10-13

For the living home screen (2026-10-13):
- players.practice_participation / practice_description: Sleeper's
  practice report ("Full" / "Limited" / "DNP"), for the Thursday and
  Friday injury checks.
- matchup_win_prob_snapshots: each live matchup's win % and score
  through the week, with each side's starters' points at that moment,
  so the Monday sweat can show the turning points and which player
  caused each one. Written by app/domain/win_prob_history.py.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b8d0f2a4c6e9'
down_revision: Union[str, Sequence[str], None] = 'a7c9e1b3d5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE players ADD COLUMN practice_participation TEXT")
    op.execute("ALTER TABLE players ADD COLUMN practice_description TEXT")
    op.execute("""
        CREATE TABLE matchup_win_prob_snapshots (
            id            BIGSERIAL PRIMARY KEY,
            season        INTEGER NOT NULL,
            league_id     INTEGER NOT NULL REFERENCES leagues(id),
            week          INTEGER NOT NULL,
            matchup_id    INTEGER NOT NULL,
            captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            home_win_pct  REAL NOT NULL,
            home_score    REAL NOT NULL,
            away_score    REAL NOT NULL,
            home_points   JSONB NOT NULL DEFAULT '{}',
            away_points   JSONB NOT NULL DEFAULT '{}'
        )
    """)
    op.execute("CREATE INDEX matchup_win_prob_snapshots_matchup ON matchup_win_prob_snapshots (matchup_id, captured_at)")


def downgrade() -> None:
    op.execute("DROP TABLE matchup_win_prob_snapshots")
    op.execute("ALTER TABLE players DROP COLUMN practice_description")
    op.execute("ALTER TABLE players DROP COLUMN practice_participation")
