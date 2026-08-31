"""add scheduled_start to draft_config

Revision ID: 6d0a4915c2da
Revises: 82734faf1fd4
Create Date: 2026-08-27 21:32:12.020072

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6d0a4915c2da'
down_revision: Union[str, Sequence[str], None] = '82734faf1fd4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """draft_config previously had no "when is the draft planned for"
    concept at all — only started_at (set once it actually begins) and
    current_pick_deadline (per-pick, once in progress). Nullable and
    set independently of the rest of draft setup (order/roster shape)
    via PUT /draft/schedule — a commissioner may know the real date
    before finalizing the order, or want to adjust just the date
    without resetting the whole draft."""
    op.execute("ALTER TABLE draft_config ADD COLUMN scheduled_start TIMESTAMPTZ")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER TABLE draft_config DROP COLUMN scheduled_start")
