"""add page view events table

Backs the new admin-only usage dashboard (app/routers/admin.py's
GET /admin/usage) — "which pages/features get used, how often, by
whom" for the site owner's own visibility, not a per-owner-visible
feature. One row per page load from a signed-in owner; POST /admin/
track-view (no admin gate — every signed-in owner can write their own
view, only the aggregate read is admin-only) is a fire-and-forget
write from the frontend on every route change (see PageViewTracker.tsx).
No owner_id-less anonymous rows: a page view before sign-in (the
opening/login screen) isn't tied to a real owner and isn't
tracked — "by whom" is the whole point of this table.

Revision ID: 2587a1c96f73
Revises: 2a4e4e30c529
Create Date: 2026-09-04 13:43:49.755671

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '2587a1c96f73'
down_revision: Union[str, Sequence[str], None] = '2a4e4e30c529'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE page_view_events (
            id SERIAL PRIMARY KEY,
            owner_id INT NOT NULL REFERENCES owners(owner_id),
            path TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX idx_page_view_events_created_at ON page_view_events(created_at)")
    op.execute("CREATE INDEX idx_page_view_events_owner_id ON page_view_events(owner_id)")


def downgrade() -> None:
    op.execute("DROP TABLE page_view_events")
