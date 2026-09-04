"""add league_roster_slots_settings table for pre-draft roster shape edits

Same reasoning as b4d8f1c2e6a9's league_draft_schedule table (this
migration's direct sibling): a commissioner should be able to set the
season's roster slot shape (QB/RB/WR/... counts) before deciding the
draft order, but draft_config.roster_slots is NOT NULL and
create_draft() immediately pre-generates every real draft_picks row
from it — so a "stub" draft_config row isn't a safe place to stage
just a roster shape ahead of time (an existing row of any kind there
also makes create_draft() refuse to run at all, since it can't tell a
stub apart from a real draft).

This table is a genuinely separate, minimal home for "what's this
season's roster shape" that needs nothing else — one row per (season,
league), used only before a real draft_config row exists. Once
POST /draft/setup runs, draft_config.roster_slots becomes the single
source of truth again (matching every existing reader — lineup_engine.
py, trades.py, draft_autopick.py), and app/routers/draft.py's PUT
/roster-slots refuses to touch a season that already has a real draft
(reset it first, same as changing draft_order/roster_slots always has
required) — unlike the schedule table, there's no automatic carry-over
into draft_config here, since the frontend (DraftSetupPanel.tsx) reads
this table directly to pre-fill its own Draft Setup roster-shape value
before the commissioner clicks "Create draft."

Revision ID: f2a91c4d7b83
Revises: 36cc4fd982e7
Create Date: 2026-09-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f2a91c4d7b83'
down_revision: Union[str, Sequence[str], None] = '36cc4fd982e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE league_roster_slots_settings (
            season INTEGER NOT NULL,
            league_id INTEGER NOT NULL REFERENCES leagues(id),
            roster_slots JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (season, league_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE league_roster_slots_settings")
