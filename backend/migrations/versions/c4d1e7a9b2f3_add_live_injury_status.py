"""add live_injury_status for in-game injury tracking

One row per (season, week, player): the latest in-game injury event
for that player that week — left the game, returned, questionable/
doubtful to return, or ruled out — from ESPN's play-by-play and
injury news (app/domain/live_injuries.py). Read by live projections
(app/domain/live_projection.py) to scale a hurt player's remaining
projection. NFL-wide facts, so not league-scoped. Purely additive.

Revision ID: c4d1e7a9b2f3
Revises: 881d55c71d2a
Create Date: 2026-09-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'c4d1e7a9b2f3'
down_revision: Union[str, Sequence[str], None] = '881d55c71d2a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE live_injury_status (
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            sleeper_player_id TEXT NOT NULL REFERENCES players(sleeper_player_id),
            state TEXT NOT NULL CHECK (state IN ('left', 'returned', 'questionable_return', 'doubtful_return', 'ruled_out')),
            source TEXT NOT NULL CHECK (source IN ('play', 'news')),
            detail TEXT,
            event_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (season, week, sleeper_player_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE live_injury_status")
