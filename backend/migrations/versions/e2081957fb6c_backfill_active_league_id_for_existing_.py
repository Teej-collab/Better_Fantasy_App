"""backfill active_league_id for existing league members

Revision ID: e2081957fb6c
Revises: 9c4e1a2f7b3d
Create Date: 2026-08-31 19:25:32.963050

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e2081957fb6c'
down_revision: Union[str, Sequence[str], None] = '9c4e1a2f7b3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """119d4af5c920 added users.active_league_id but never backfilled
    it — every real existing league_members row (from Phase 2's League
    #1 backfill, before session-resolved active league existed at all)
    left active_league_id NULL. Shipping app/auth/league_context.py's
    require_active_league_id as-is against that would 409 every real
    existing member out of My Team/Draft/Keepers/Chug/Settings/Admin
    the moment it deployed — confirmed directly against the real DB
    (both real members, user_id 1 and 59, still NULL) before writing
    this. Picks each user's EARLIEST membership (by joined_at) as the
    default active league, for the general case where someone is
    already in more than one league by the time this runs — not just
    today's single-league reality."""
    op.execute(
        """
        UPDATE users
        SET active_league_id = earliest.league_id
        FROM (
            SELECT DISTINCT ON (user_id) user_id, league_id
            FROM league_members
            ORDER BY user_id, joined_at ASC
        ) AS earliest
        WHERE users.id = earliest.user_id AND users.active_league_id IS NULL
        """
    )


def downgrade() -> None:
    """Deliberately a no-op, not a blanket re-NULL — a backfilled value
    is indistinguishable from one a real POST /leagues/{id}/select call
    set afterward, and clobbering the latter on downgrade would be a
    real, silent data loss for no benefit (the upgrade itself is
    idempotent and safe to re-run)."""
    pass
