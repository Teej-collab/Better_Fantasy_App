"""add draft_queue_items table

Revision ID: 63291a4c50ae
Revises: ed4c14eb48c4
Create Date: 2026-09-05 08:23:01.015664

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '63291a4c50ae'
down_revision: Union[str, Sequence[str], None] = 'ed4c14eb48c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Server-authoritative draft queue/wishlist (2026-09, draft night
    # feature) — a personal ranked player list per owner, scoped to one
    # specific draft (season + league_id), same scoping every other
    # draft-adjacent table already uses (there's no separate "drafts"
    # table to key off of directly). rank is a real integer column, not
    # array position, so reordering/renumbering is explicit and
    # queryable (ORDER BY rank) rather than depending on row insertion
    # order. Two unique constraints: an owner can never queue the same
    # player twice in the same draft, and an owner's queue can never
    # have two players sharing one rank (both enforced by the DB, not
    # just app-level discipline, since concurrent reorder requests are
    # a real possibility during a live draft).
    op.execute(
        """
        CREATE TABLE draft_queue_items (
            id SERIAL PRIMARY KEY,
            season INTEGER NOT NULL,
            league_id INTEGER NOT NULL REFERENCES leagues(id),
            owner_id INTEGER NOT NULL REFERENCES owners(owner_id),
            sleeper_player_id TEXT NOT NULL,
            rank INTEGER NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (season, league_id, owner_id, sleeper_player_id),
            UNIQUE (season, league_id, owner_id, rank)
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_draft_queue_items_owner ON draft_queue_items (season, league_id, owner_id, rank)"
    )
    # Fast "did someone just draft a player who's on ANY queue" lookup —
    # this is a whole-draft scan (every owner's queue, not just one),
    # so it needs its own index on (season, league_id, sleeper_player_id)
    # rather than piggybacking on the owner-scoped index above.
    op.execute(
        "CREATE INDEX idx_draft_queue_items_player ON draft_queue_items (season, league_id, sleeper_player_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE draft_queue_items")
