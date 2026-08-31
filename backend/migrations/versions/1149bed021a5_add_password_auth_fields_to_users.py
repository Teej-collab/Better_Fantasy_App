"""add password auth fields to users

Revision ID: 1149bed021a5
Revises: 454d8edda612
Create Date: 2026-08-31 09:49:31.383090

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1149bed021a5'
down_revision: Union[str, Sequence[str], None] = '454d8edda612'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Phase 5 of the multi-league migration (see TODO.md's PHASE 9
    entry) — email+password as a second, independent way to get a real
    Weekend account, alongside Discord (not a replacement for it).

    password_hash is nullable on purpose: a Discord-only user still has
    no password at all, and login for them stays exactly what it's
    always been. display_name is new here too — until now a user's
    display name lived entirely on `owners` (a per-league concept, and
    Discord users only ever got a users row via an existing owners
    match). A self-serve signup has no owners row at all yet (nothing
    to join or create until they pick a league), so the account needs
    its own name independent of any league membership.
    """
    op.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
    op.execute("ALTER TABLE users ADD COLUMN display_name TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN display_name")
    op.execute("ALTER TABLE users DROP COLUMN password_hash")
