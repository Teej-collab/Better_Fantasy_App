"""add weekly narratives table

The cache for the new whole-week recap/preview feature — a single
narrative tying an entire week's matchups + real awards together in
one voice, as opposed to matchup_narratives (migration 7a2c9e4b6f1d),
which caches one narrative per individual matchup. Same real-Anthropic-
API-cost-per-generation reasoning, same cache-forever-once-generated
shape, just keyed by (season, week, league_id, kind) instead of
matchup_id.

Deliberately no FK on league_id despite the DEFAULT/REFERENCES
elsewhere in this schema being the norm for newer tables... actually
DOES reference leagues(id), matching every other Phase-3-era table's
convention (league_scoring_rules, draft_config, etc.) — a league_id is
never bulk-deleted/resynced the way a matchup_id's parent row can be,
so this one destructive-resync concern that made matchup_narratives.
matchup_id deliberately FK-less doesn't apply here.

Revision ID: 36cc4fd982e7
Revises: 699231c06dfa
Create Date: 2026-09-03 14:40:53.293577

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '36cc4fd982e7'
down_revision: Union[str, Sequence[str], None] = '699231c06dfa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE weekly_narratives (
            id SERIAL PRIMARY KEY,
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            league_id INTEGER NOT NULL DEFAULT 1 REFERENCES leagues(id),
            kind TEXT NOT NULL CHECK (kind IN ('preview', 'recap')),
            text TEXT NOT NULL,
            model TEXT NOT NULL,
            generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (season, week, league_id, kind)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE weekly_narratives")
