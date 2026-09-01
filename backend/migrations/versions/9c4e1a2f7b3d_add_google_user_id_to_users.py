"""add google_user_id to users

Sign in with Google, a second OAuth option alongside Discord. Mirrors
0528c1f9a3cb's discord_user_id column exactly (unique, nullable), with
one real difference: Google's "sub" claim is a string, not a numeric
snowflake, so this is TEXT rather than BIGINT.

Unlike Discord (verified against a real owners.discord_user_id — real
league membership, already synced from ESPN), Google has no equivalent
pre-existing membership data, so a Google sign-in follows the same
self-serve path email/password already does: create an account, no
owners row yet, join a league with an invite code afterward. See
app/queries/auth.py's get_or_create_user_for_google.

Revision ID: 9c4e1a2f7b3d
Revises: 7a2c9e4b6f1d
Create Date: 2026-09-01 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '9c4e1a2f7b3d'
down_revision: Union[str, Sequence[str], None] = '7a2c9e4b6f1d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN google_user_id TEXT UNIQUE")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN google_user_id")
