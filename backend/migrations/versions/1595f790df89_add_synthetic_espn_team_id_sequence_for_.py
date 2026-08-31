"""add synthetic espn team id sequence for self-serve teams

Revision ID: 1595f790df89
Revises: 1149bed021a5
Create Date: 2026-08-31 09:57:24.797473

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1595f790df89'
down_revision: Union[str, Sequence[str], None] = '1149bed021a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """teams_by_season.espn_team_id is NOT NULL and UNIQUE per season
    (deliberately left that way in migration 454d8edda612 — widening it
    to include league_id is a correctness change, not a column-only
    one). A self-serve team created in a brand-new, non-ESPN league
    still needs *some* value there — this sequence hands out ids
    starting at 1,000,000, far above any real ESPN team id (always a
    small number, League #1's are 1-12), so a synthetic id can never
    collide with a real synced one, in any season, ever."""
    op.execute("CREATE SEQUENCE synthetic_espn_team_id_seq START WITH 1000000")


def downgrade() -> None:
    op.execute("DROP SEQUENCE synthetic_espn_team_id_seq")
