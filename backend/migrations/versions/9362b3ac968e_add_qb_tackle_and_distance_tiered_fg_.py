"""add qb_tackle and distance-tiered fg miss scoring

Revision ID: 9362b3ac968e
Revises: 4db5719dc5e7
Create Date: 2026-09-04 19:59:27.682273

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9362b3ac968e'
down_revision: Union[str, Sequence[str], None] = '4db5719dc5e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # qb_tackle (15 pts): a QB's own tackle is worth a different amount
    # than a defensive player's — app/domain/weekly_stats.py now splits
    # ESPN's single, position-agnostic def_tackle stat into qb_tackle
    # vs def_tackle by the player's own position before scoring. Not
    # touching def_tackle's own existing value here — it stays what it
    # was, now scoped to non-QB players only going forward.
    #
    # fg_miss_total (-1 flat, added in 4db5719dc5e7) is superseded by
    # real distance-tiered misses now that
    # app/providers/nfl_stats/espn_public.py's _parse_fg_misses_by_player
    # can read a miss's actual yardage from drives.previous[].plays[]'s
    # statYardage field — removed here rather than left stale alongside
    # the new tiers.
    op.execute(
        """
        INSERT INTO league_scoring_rules (season, stat_category, points_per_unit, league_id) VALUES
            (2026, 'qb_tackle', 15, 1),
            (2026, 'fg_miss_0_29', -5, 1),
            (2026, 'fg_miss_30_39', -3, 1),
            (2026, 'fg_miss_40_49', -1, 1),
            (2026, 'fg_miss_50_plus', 0, 1)
        ON CONFLICT (season, stat_category, league_id) DO UPDATE SET points_per_unit = EXCLUDED.points_per_unit
        """
    )
    op.execute(
        "DELETE FROM league_scoring_rules WHERE league_id = 1 AND season = 2026 AND stat_category = 'fg_miss_total'"
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM league_scoring_rules WHERE league_id = 1 AND season = 2026 AND stat_category IN
            ('qb_tackle', 'fg_miss_0_29', 'fg_miss_30_39', 'fg_miss_40_49', 'fg_miss_50_plus')
        """
    )
    op.execute(
        """
        INSERT INTO league_scoring_rules (season, stat_category, points_per_unit, league_id)
        VALUES (2026, 'fg_miss_total', -1, 1)
        ON CONFLICT (season, stat_category, league_id) DO UPDATE SET points_per_unit = EXCLUDED.points_per_unit
        """
    )
