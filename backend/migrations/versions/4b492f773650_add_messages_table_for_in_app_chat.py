"""add messages table for in-app chat

Aug 20 2026 work session: a single, league-wide chat room (no channels
or DMs in this first version — nothing in the product ask specified
those, and a 12-person league doesn't obviously need them yet).
owner_id, not user_id or discord_user_id, since every other real-data
table in this app (teams_by_season, chug_debts, season_awards, ...)
keys off owner_id as the one real "who is this" identity, and a message
sender should join the same way.

Revision ID: 4b492f773650
Revises: 9abaa1b7d38f
Create Date: 2026-08-20 08:21:11.451137

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '4b492f773650'
down_revision: Union[str, Sequence[str], None] = '9abaa1b7d38f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE messages (
            id              SERIAL PRIMARY KEY,
            owner_id        INT NOT NULL REFERENCES owners(owner_id),
            body            TEXT NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX idx_messages_created_at ON messages (created_at)")


def downgrade() -> None:
    op.execute("DROP TABLE messages")
