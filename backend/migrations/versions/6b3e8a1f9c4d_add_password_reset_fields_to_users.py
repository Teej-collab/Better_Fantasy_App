"""add password reset fields to users

Backs the new POST /auth/forgot-password / POST /auth/reset-password
endpoints. Nullable, single-use, single-column token — same shape as
password_hash itself (1149bed021a5), which is nullable for the same
reason (a Discord/Google-only account has no password to reset). No
separate password_reset_tokens table: at most one outstanding reset
per account is ever meaningful (a newer request should simply replace
an older one, not queue behind it), so a second column pair is
simpler and sufficient rather than a real one-to-many relationship.

Revision ID: 6b3e8a1f9c4d
Revises: 9a1f5c7d0e2b
Create Date: 2026-09-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '6b3e8a1f9c4d'
down_revision: Union[str, Sequence[str], None] = '9a1f5c7d0e2b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN password_reset_token TEXT")
    op.execute("ALTER TABLE users ADD COLUMN password_reset_token_expires_at TIMESTAMPTZ")
    # Every lookup by token (POST /auth/reset-password) needs to find
    # the one matching row fast — a plain B-tree on a random, unique-
    # in-practice token value, same reasoning as any other lookup-by-
    # opaque-token column in this app.
    op.execute("CREATE INDEX ix_users_password_reset_token ON users (password_reset_token)")


def downgrade() -> None:
    op.execute("DROP INDEX ix_users_password_reset_token")
    op.execute("ALTER TABLE users DROP COLUMN password_reset_token_expires_at")
    op.execute("ALTER TABLE users DROP COLUMN password_reset_token")
