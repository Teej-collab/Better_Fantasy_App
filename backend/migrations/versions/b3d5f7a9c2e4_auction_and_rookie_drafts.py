"""auction drafts and dynasty rookie drafts

League formats (2026-10):
- draft_picks.price: what an auction pick cost (NULL in a snake draft).
  An auction's picks are written as players are won, not planned ahead.
- draft_config.pool: 'all' (every draftable player) or 'rookies' (a
  dynasty league's rookie draft — first-year players only).
- draft_auction: the live auction, one row per draft — whose turn it is
  to nominate, the player up for bid, the high bid and bidder. The
  clock itself is draft_config.current_pick_deadline, the same column
  the snake draft's clock job already watches.

draft_config.draft_type (existing, default 'snake') gains 'linear'
(the rookie draft: the same order every round) and 'auction'.

Revision ID: b3d5f7a9c2e4
Revises: a2c4e6f8b1d3
Create Date: 2026-10-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b3d5f7a9c2e4'
down_revision: Union[str, Sequence[str], None] = 'a2c4e6f8b1d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE draft_picks ADD COLUMN price INTEGER CHECK (price >= 0)")
    op.execute(
        "ALTER TABLE draft_config ADD COLUMN pool TEXT NOT NULL DEFAULT 'all' CHECK (pool IN ('all', 'rookies'))"
    )
    op.execute(
        """
        CREATE TABLE draft_auction (
            season INTEGER NOT NULL,
            league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
            budget INTEGER NOT NULL,
            nomination_index INTEGER NOT NULL DEFAULT 0,
            nominator_owner_id INTEGER REFERENCES owners(owner_id),
            nominee_sleeper_id TEXT,
            high_bid INTEGER,
            high_bidder_owner_id INTEGER REFERENCES owners(owner_id),
            nominated_at TIMESTAMPTZ,
            PRIMARY KEY (season, league_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE draft_auction")
    op.execute("ALTER TABLE draft_config DROP COLUMN pool")
    op.execute("ALTER TABLE draft_picks DROP COLUMN price")
