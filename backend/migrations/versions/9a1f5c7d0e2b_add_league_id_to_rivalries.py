"""add league_id to rivalries

rivalries predates multi-league support and was missed by the Phase 3
season-scoped-table sweep (454d8edda612) since it isn't season-scoped
— flagged as a known follow-up directly in app/queries/league.py's
module docstring and app/routers/league.py's /rivalries endpoint.
Fixes it the same column-only, backfilled, non-breaking way every
other fantasy-league-scoped table was fixed: ADD COLUMN with
DEFAULT 1 (see 454d8edda612 and e47b2a91c5d8 for the same reasoning) —
today there's exactly one seeded rivalry pair, for League #1, so the
default backfills every existing row correctly with no data loss.

Does not attempt to seed rivalries for any other league or build a
recompute job for stale all-time-win totals — both are separate,
already-known gaps, not part of this fix.

Revision ID: 9a1f5c7d0e2b
Revises: 224c44524737
Create Date: 2026-09-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '9a1f5c7d0e2b'
down_revision: Union[str, Sequence[str], None] = '224c44524737'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE rivalries ADD COLUMN league_id INT NOT NULL DEFAULT 1 REFERENCES leagues(id)")


def downgrade() -> None:
    op.execute("ALTER TABLE rivalries DROP COLUMN league_id")
