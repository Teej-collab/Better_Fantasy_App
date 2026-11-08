"""user push subscriptions

Web Push for an account that isn't on any team yet (2026-11-07), the web
twin of user_push_tokens: push_subscriptions.owner_id is NOT NULL, so a
browser signed in to an account that's only in survivor pools couldn't
subscribe at all. It subscribes here instead, and moves to
push_subscriptions once the account gets a team.

Revision ID: b9c1d3e5f7a9
Revises: a8b0c2d4e6f7
Create Date: 2026-11-07
"""
from typing import Sequence, Union

from alembic import op

revision: str = "b9c1d3e5f7a9"
down_revision: Union[str, None] = "a8b0c2d4e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE user_push_subscriptions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            device_label TEXT,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_successful_delivery_at TIMESTAMPTZ,
            last_failure_at TIMESTAMPTZ
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE user_push_subscriptions")
