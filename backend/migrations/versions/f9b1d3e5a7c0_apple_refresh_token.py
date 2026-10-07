"""users.apple_refresh_token — revoke Sign in with Apple on account deletion

Apple asks apps that offer Sign in with Apple to revoke the user's Apple
token when they delete their account. That needs the refresh token from
exchanging the sign-in's authorization code, kept here encrypted
(app/encryption.py) until the account is deleted.

Revision ID: f9b1d3e5a7c0
Revises: e8a0c2d4f6b9
Create Date: 2026-10-07 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f9b1d3e5a7c0'
down_revision: Union[str, Sequence[str], None] = 'e8a0c2d4f6b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN apple_refresh_token TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN apple_refresh_token")
