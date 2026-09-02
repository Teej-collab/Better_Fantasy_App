"""add league_draft_schedule table for setting a draft time before setup

Lets a commissioner set the real draft date/time before deciding the
draft order/roster shape — previously PUT /draft/schedule required a
real draft_config row to already exist (draft_config.draft_order/
roster_slots are NOT NULL and create_draft immediately generates real
draft_picks rows from them, so a "stub" draft_config with placeholder
data isn't a safe way to hold just a schedule). This table is a
genuinely separate, minimal home for "when is the draft" that needs
nothing else — one row per (season, league), created/updated
independently of draft_config's own lifecycle.

Once a real draft_config row exists, IT becomes the single source of
truth for scheduled_start again (matching every existing reader —
your_week.py, keepers.py, DraftCountdownCard.tsx) — app/domain/
draft_engine.py's create_draft copies any pre-set schedule from this
table into the new draft_config row and removes it from here, so this
table only ever holds a schedule for a season with no real draft set
up yet.

Revision ID: b4d8f1c2e6a9
Revises: a3c7e2f9b1d4
Create Date: 2026-09-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b4d8f1c2e6a9'
down_revision: Union[str, Sequence[str], None] = 'a3c7e2f9b1d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE league_draft_schedule (
            season INTEGER NOT NULL,
            league_id INTEGER NOT NULL REFERENCES leagues(id),
            scheduled_start TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (season, league_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE league_draft_schedule")
