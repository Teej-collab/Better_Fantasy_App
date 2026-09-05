"""restore fg_miss_total as a real computed stat

Revision ID: 4db5719dc5e7
Revises: 67fc0625913c
Create Date: 2026-09-04 19:39:30.691033

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4db5719dc5e7'
down_revision: Union[str, Sequence[str], None] = '67fc0625913c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Restored at its original configured value (-1) from before the
    # previous migration removed it as dead config — it's real now:
    # app/providers/nfl_stats/espn_public.py computes it as attempts
    # minus makes from the same kicking boxscore data already parsed
    # for xp_made. Per-distance FG-miss buckets (fg_miss_0_39/40_49/
    # 50_plus) stay out — a miss's own distance genuinely isn't
    # available anywhere in ESPN's public data (it doesn't score, so
    # it never appears in scoringPlays, and isn't broken out from the
    # makes/attempts ratio either).
    op.execute(
        """
        INSERT INTO league_scoring_rules (season, stat_category, points_per_unit, league_id)
        VALUES (2026, 'fg_miss_total', -1, 1)
        ON CONFLICT (season, stat_category, league_id) DO UPDATE SET points_per_unit = EXCLUDED.points_per_unit
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM league_scoring_rules WHERE league_id = 1 AND season = 2026 AND stat_category = 'fg_miss_total'")
