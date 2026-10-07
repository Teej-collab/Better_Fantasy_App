"""live_activity_tokens.asset_dir — where the phone keeps team logos

Live Activities can't download images, so the app saves each team's
logo into its widgets folder on the phone and tells the backend where
that folder is; the backend passes it along in every update so the
Lock Screen and Dynamic Island show the logos (2026-10).

Revision ID: b2c4e6a8d0f1
Revises: a1d3f5b7c9e2
Create Date: 2026-10-07 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b2c4e6a8d0f1'
down_revision: Union[str, Sequence[str], None] = 'a1d3f5b7c9e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE live_activity_tokens ADD COLUMN asset_dir TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE live_activity_tokens DROP COLUMN asset_dir")
