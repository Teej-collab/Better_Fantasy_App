"""extend users table for discord auth

Phase 5 auth decision: sign in with Discord, verified against
owners.discord_user_id (real league membership, already synced from
ESPN). Discord's OAuth doesn't reliably return a verified email without
extra consent scope, so email becomes optional and discord_user_id
becomes the actual identity key for a user account.

Revision ID: 0528c1f9a3cb
Revises: a80e40f20fa5
Create Date: 2026-08-19 09:29:41.927150

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '0528c1f9a3cb'
down_revision: Union[str, Sequence[str], None] = 'a80e40f20fa5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ALTER COLUMN email DROP NOT NULL")
    op.execute("ALTER TABLE users ADD COLUMN discord_user_id BIGINT UNIQUE")
    op.execute("ALTER TABLE users ADD COLUMN discord_username TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN discord_username")
    op.execute("ALTER TABLE users DROP COLUMN discord_user_id")
    op.execute("ALTER TABLE users ALTER COLUMN email SET NOT NULL")
