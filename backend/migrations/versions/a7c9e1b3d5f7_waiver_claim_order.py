"""waiver claim order

Revision ID: a7c9e1b3d5f7
Revises: f6b8d0a2c4e8
Create Date: 2026-10-12

A team ranks its own pending claims, like ESPN's Waiver Claims > Edit
(2026-10-12 ask): when several of its claims clear in the same run, the
first one it can win goes first. Existing claims keep the order they
were made in. See app/domain/waivers.py's process_expired_waivers.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'a7c9e1b3d5f7'
down_revision: Union[str, Sequence[str], None] = 'f6b8d0a2c4e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE waiver_claims ADD COLUMN claim_order INT NOT NULL DEFAULT 0")
    op.execute("""
        UPDATE waiver_claims wc SET claim_order = ranked.n
        FROM (
            SELECT id, row_number() OVER (PARTITION BY season, league_id, team_id ORDER BY created_at, id) AS n
            FROM waiver_claims
        ) ranked
        WHERE ranked.id = wc.id
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE waiver_claims DROP COLUMN claim_order")
