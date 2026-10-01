"""add recap_releases

One row per (league, season, week) once that week's recap goes live at
the Tuesday flip (app/domain/recap_release.py): when it was released and
how many owners were pushed "Week N Recap LIVE NOW". The primary key
makes the release (and its push) happen exactly once, even if the flip
job re-runs; the admin dashboard's Recaps page reads it alongside the
recap_opened analytics events to show who actually read each recap.

Revision ID: c5e1a9d3f7b2
Revises: b4d8e2f6a1c3
Create Date: 2026-10-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c5e1a9d3f7b2'
down_revision: Union[str, Sequence[str], None] = 'b4d8e2f6a1c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE recap_releases (
            league_id INTEGER NOT NULL,
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            released_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            notified_count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (league_id, season, week)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE recap_releases")
