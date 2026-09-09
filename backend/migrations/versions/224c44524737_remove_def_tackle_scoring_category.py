"""remove def_tackle as a scoring category entirely

This league's real rule (the commissioner, 2026-09): nobody except a
QB is ever awarded points for a tackle — D/ST is scored on sacks, not
tackles. def_tackle existed because ESPN's own "defensive"/
totalTackles boxscore stat isn't position-scoped at all (see
app/providers/nfl_stats/espn_public.py's docstring) — a rostered
RB/WR/TE occasionally records a real one (e.g. chasing down a
turnover after a fumble/interception), and without a category for it
that stat would otherwise just vanish silently. The commissioner had
already zeroed its points_per_unit to 0 in the real league
(2026-09-08) after noticing it in the scoring-rules editor; this
finishes the job by removing it as a selectable category at all,
across every league/season, not just this one's now-zeroed row —
seed_default_scoring_rules (app/queries/leagues.py) copies League #1's
own current rows into every newly created league, so leaving even a
zeroed row around would keep propagating a category that shouldn't
exist as an option. app/domain/weekly_stats.py's ingestion pipeline
now drops a non-QB's tackle stat outright instead of storing it under
this category (see that module's own comment) — this migration is the
matching cleanup for rows already written under the old behavior.

qb_tackle (a QB's own tackle, e.g. after his own interception gets
returned) is untouched — that's the one real, intentional scoring
lever for a tackle in this league, unaffected by this migration.

Revision ID: 224c44524737
Revises: 3c8416bb59e1
Create Date: 2026-09-08 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = '224c44524737'
down_revision: Union[str, Sequence[str], None] = '3c8416bb59e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DELETE FROM league_scoring_rules WHERE stat_category = 'def_tackle'")


def downgrade() -> None:
    # Not restorable to its exact prior per-league point values (this
    # deletes real, possibly-customized rows) — re-add at 1 point/unit,
    # this app's own original default (migration 67fc0625913c), for
    # every league/season that currently has any scoring rules at all.
    op.execute(
        """
        INSERT INTO league_scoring_rules (season, league_id, stat_category, points_per_unit)
        SELECT DISTINCT season, league_id, 'def_tackle', 1
        FROM league_scoring_rules
        ON CONFLICT (season, stat_category, league_id) DO NOTHING
        """
    )
