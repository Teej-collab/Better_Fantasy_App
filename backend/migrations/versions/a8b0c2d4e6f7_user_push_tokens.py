"""user push tokens

A phone's push token for an account that isn't on any team yet
(2026-11-07). Push has always been per owner (native_push_tokens.owner_id),
so someone who's only in a survivor pool had nowhere to register and got
no "make your pick" reminders. Their phone registers here instead, and
moves to native_push_tokens once the account gets a team.

Revision ID: a8b0c2d4e6f7
Revises: f7c9e1a3b5d4
Create Date: 2026-11-07
"""
from typing import Sequence, Union

from alembic import op

revision: str = "a8b0c2d4e6f7"
down_revision: Union[str, None] = "f7c9e1a3b5d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE user_push_tokens (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            device_id TEXT NOT NULL,
            platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
            push_token TEXT NOT NULL,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_successful_delivery_at TIMESTAMPTZ,
            last_failure_at TIMESTAMPTZ,
            UNIQUE (user_id, device_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE user_push_tokens")
