"""add leagues and league_members tables

Revision ID: d7deccb620bb
Revises: 6d0a4915c2da
Create Date: 2026-08-31 07:54:57.519790

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd7deccb620bb'
down_revision: Union[str, Sequence[str], None] = '6d0a4915c2da'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Phase 1 of the multi-league migration (see the "Open Roster"
    architecture plan) — schema only, new tables, nothing else touched.
    Every existing table (owners, teams_by_season, draft_config, ...)
    still works exactly as before; they gain their own league_id in a
    later, separate migration once the domain layer is ready to filter
    by it. Until then, the real league simply has no league_members
    rows yet — nothing reads these tables.

    invite_code is NOT NULL: every league is expected to always have
    one generated at creation time by the domain layer (not here) —
    this table is never meant to hold a league with no way to join it.
    """
    op.execute("""
        CREATE TABLE leagues (
            id                  SERIAL PRIMARY KEY,
            name                TEXT NOT NULL,
            created_by_user_id  INT NOT NULL REFERENCES users(id),
            invite_code         TEXT NOT NULL UNIQUE,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE league_members (
            id          SERIAL PRIMARY KEY,
            league_id   INT NOT NULL REFERENCES leagues(id),
            user_id     INT NOT NULL REFERENCES users(id),
            role        TEXT NOT NULL CHECK (role IN ('commissioner', 'member')),
            joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (league_id, user_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE league_members")
    op.execute("DROP TABLE leagues")
