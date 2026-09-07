"""add draft_grades and draft_narratives tables

Real data-driven draft grades (percentile rank of a team's total
drafted players.projected_points among the season's real drafters,
mapped to a letter grade — see app/domain/draft_grades.py) plus an
AI-generated recap per team, reusing the exact matchup_narratives/
weekly_narratives cache-forever pattern (app/providers/anthropic_narrative.py's
generate_narrative(), unchanged).

Two tables, not one, same reasoning as narrative_engine.py's own split
between a matchup's real stats and its cached LLM text: the grade is
cheap, deterministic, and instantly recomputable from draft_picks at
any time; the narrative is the one expensive-to-regenerate LLM output.
A grade can render even before/if the write-up generation fails or
ANTHROPIC_API_KEY isn't set.

One row per owner per season (no `kind` enum — unlike matchup/weekly
narratives, this isn't preview-vs-recap, just one draft-recap text).

Revision ID: 03100a8a1874
Revises: 3ced9294bbeb
Create Date: 2026-09-07 23:40:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '03100a8a1874'
down_revision: Union[str, Sequence[str], None] = '3ced9294bbeb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE draft_grades (
            id SERIAL PRIMARY KEY,
            season INTEGER NOT NULL,
            league_id INTEGER NOT NULL REFERENCES leagues(id),
            owner_id INTEGER NOT NULL REFERENCES owners(owner_id),
            total_projected_points NUMERIC NOT NULL,
            league_avg_projected_points NUMERIC NOT NULL,
            percentile NUMERIC NOT NULL,
            letter_grade TEXT NOT NULL,
            computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (season, league_id, owner_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE draft_narratives (
            id SERIAL PRIMARY KEY,
            season INTEGER NOT NULL,
            league_id INTEGER NOT NULL REFERENCES leagues(id),
            owner_id INTEGER NOT NULL REFERENCES owners(owner_id),
            text TEXT NOT NULL,
            model TEXT NOT NULL,
            generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (season, league_id, owner_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE draft_narratives")
    op.execute("DROP TABLE draft_grades")
