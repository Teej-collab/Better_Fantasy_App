"""notification inbox and switches

The notification inbox (2026-11-08): every push we send (or hold, or
drop for quiet hours) is kept for 30 days, so there's a place to see
what you missed. One row per recipient: an owner, or an account with no
team (a survivor-only player). A push with a tag (a lead flipping back
and forth) replaces its earlier row, the same way it replaces the
earlier notification on the phone.

Plus switches for the kinds of push added since Settings > Notifications
was laid out: trades, survivor, friends & Lounge invites, and the draft.

Revision ID: c2d4e6f8a0b3
Revises: b9c1d3e5f7a9
Create Date: 2026-11-08
"""
from typing import Sequence, Union

from alembic import op

revision: str = "c2d4e6f8a0b3"
down_revision: Union[str, None] = "b9c1d3e5f7a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE notifications (
            id BIGSERIAL PRIMARY KEY,
            owner_id INTEGER REFERENCES owners(owner_id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL DEFAULT '',
            url TEXT NOT NULL,
            tag TEXT,
            data JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            read_at TIMESTAMPTZ,
            CHECK ((owner_id IS NULL) <> (user_id IS NULL))
        )
        """
    )
    op.execute("CREATE INDEX notifications_owner_idx ON notifications (owner_id, created_at DESC) WHERE owner_id IS NOT NULL")
    op.execute("CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC) WHERE user_id IS NOT NULL")
    op.execute("CREATE UNIQUE INDEX notifications_owner_tag ON notifications (owner_id, tag) WHERE owner_id IS NOT NULL AND tag IS NOT NULL")
    op.execute("CREATE UNIQUE INDEX notifications_user_tag ON notifications (user_id, tag) WHERE user_id IS NOT NULL AND tag IS NOT NULL")
    op.execute("CREATE INDEX notifications_created_idx ON notifications (created_at)")
    for column in ("notify_trades", "notify_survivor", "notify_friends", "notify_draft"):
        op.execute(f"ALTER TABLE owner_preferences ADD COLUMN {column} BOOLEAN NOT NULL DEFAULT TRUE")


def downgrade() -> None:
    for column in ("notify_trades", "notify_survivor", "notify_friends", "notify_draft"):
        op.execute(f"ALTER TABLE owner_preferences DROP COLUMN {column}")
    op.execute("DROP TABLE notifications")
