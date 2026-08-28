"""add team bye weeks table

Revision ID: 82734faf1fd4
Revises: b4f1a9c8e6d2
Create Date: 2026-08-27 18:05:34.603599

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '82734faf1fd4'
down_revision: Union[str, Sequence[str], None] = 'b4f1a9c8e6d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Cached, computed-once-per-season NFL team bye weeks — a real
    league_scoring_rules-style small lookup table, not derived live on
    every roster page load. Computed from app/domain/bye_weeks.py's
    compute_bye_weeks(), which finds each team's one missing week
    across 18 real scoreboard fetches (app/providers/nfl_scoreboard.py)
    -- too slow/wasteful to redo per request for data that doesn't
    change all season. See app/routers/admin.py's
    POST /admin/sync/bye-weeks for the (commissioner-triggered, not a
    continuous scheduler) refresh path."""
    op.execute("""
        CREATE TABLE team_bye_weeks (
            season      INT NOT NULL,
            pro_team    TEXT NOT NULL,
            bye_week    INT NOT NULL,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (season, pro_team)
        )
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP TABLE team_bye_weeks")
