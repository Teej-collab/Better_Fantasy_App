"""add def_tackle and fg_yds scoring, remove dead fg buckets

Revision ID: 67fc0625913c
Revises: a8244d711e8d
Create Date: 2026-09-04 19:25:48.672064

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '67fc0625913c'
down_revision: Union[str, Sequence[str], None] = 'a8244d711e8d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_DEAD_FG_BUCKET_CATEGORIES = (
    "fg_0_39", "fg_40_49", "fg_50_59", "fg_60_plus",
    "fg_miss_0_39", "fg_miss_40_49", "fg_miss_50_plus", "fg_miss_total",
)


def upgrade() -> None:
    # These bucket categories were configured in Settings but never
    # actually computed by anything — app/providers/nfl_stats/
    # espn_public.py never mapped field goals at all (ESPN's boxscore
    # only exposes game-total kicking stats, not per-kick distance;
    # see SCORING_ENGINE_SOURCE.md's "Known gap"). Kickers have scored
    # zero FG points all season. Removing them rather than leaving
    # dead, misleading config sitting in the scoring rules UI.
    placeholders = ", ".join(f"'{c}'" for c in _DEAD_FG_BUCKET_CATEGORIES)
    op.execute(f"DELETE FROM league_scoring_rules WHERE league_id = 1 AND season = 2026 AND stat_category IN ({placeholders})")

    # fg_yds: real field-goal-yards-made scoring, now actually computed
    # (app/providers/nfl_stats/espn_public.py parses each made kick's
    # distance from ESPN's scoringPlays) — 0.1 points per yard, per the
    # owner's own request.
    op.execute(
        """
        INSERT INTO league_scoring_rules (season, stat_category, points_per_unit, league_id)
        VALUES (2026, 'fg_yds', 0.1, 1)
        ON CONFLICT (season, stat_category, league_id) DO UPDATE SET points_per_unit = EXCLUDED.points_per_unit
        """
    )

    # def_tackle: real per-player tackle count (ESPN's boxscore
    # "defensive" category's totalTackles field, same reliability as
    # sacks/interceptions already scored) — 1 point per tackle, a
    # reasonable, commissioner-adjustable default (Settings > Scoring
    # Rules already lets this be tuned like every other category).
    op.execute(
        """
        INSERT INTO league_scoring_rules (season, stat_category, points_per_unit, league_id)
        VALUES (2026, 'def_tackle', 1, 1)
        ON CONFLICT (season, stat_category, league_id) DO UPDATE SET points_per_unit = EXCLUDED.points_per_unit
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM league_scoring_rules WHERE league_id = 1 AND season = 2026 AND stat_category IN ('fg_yds', 'def_tackle')")
    op.execute(
        """
        INSERT INTO league_scoring_rules (season, stat_category, points_per_unit, league_id) VALUES
        (2026, 'fg_0_39', 3, 1), (2026, 'fg_40_49', 4, 1), (2026, 'fg_50_59', 5, 1), (2026, 'fg_60_plus', 6, 1),
        (2026, 'fg_miss_0_39', -5, 1), (2026, 'fg_miss_40_49', -3, 1), (2026, 'fg_miss_50_plus', -1, 1), (2026, 'fg_miss_total', -1, 1)
        ON CONFLICT (season, stat_category, league_id) DO NOTHING
        """
    )
