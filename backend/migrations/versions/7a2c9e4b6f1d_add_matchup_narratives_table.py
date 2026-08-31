"""add matchup_narratives table

The cache for the weekly matchup write-up feature (app/domain/
narrative_engine.py) — real Anthropic API cost per generation, so this
table exists specifically so Claude gets called once per matchup per
state ("preview" before kickoff, "recap" once the league has moved
past that week), never once per page view. unique on
(matchup_id, kind) so a preview and a recap for the same matchup can
coexist as two separate rows, and re-generating either is a real
decision (delete + re-insert), never an accidental double-spend.

matchup_id has no FK to matchups.id — same "no cross-cluster FK"
convention this app already uses for weekly_team_stats/bench_crimes
(team_id there isn't FK'd either), since matchups can be bulk
deleted/re-synced by a full resync and this cache should just go stale
gracefully (a narrative for a matchup_id that no longer exists is
simply never looked up again) rather than block that resync on a
cascade or an orphaned-row cleanup step.

Revision ID: 7a2c9e4b6f1d
Revises: 119d4af5c920
Create Date: 2026-09-01 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '7a2c9e4b6f1d'
down_revision: Union[str, Sequence[str], None] = '119d4af5c920'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE matchup_narratives (
            id SERIAL PRIMARY KEY,
            matchup_id INTEGER NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('preview', 'recap')),
            text TEXT NOT NULL,
            model TEXT NOT NULL,
            generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (matchup_id, kind)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE matchup_narratives")
