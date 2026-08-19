"""add users table

App-login accounts, kept separate from `owners` (which is ESPN-derived
league membership data — see ARCHITECTURE.md's "provider data vs. internal
normalized data" separation). Only the columns every auth approach needs
are added here; auth-mechanism-specific columns (password_hash, or an
oauth_provider/oauth_subject pair) are deliberately left for Phase 5, once
that decision is made (see ARCHITECTURE.md's Auth section and TODO.md
Phase 5) — adding them now would be guessing ahead of a decision that
isn't made yet.

`owners.user_id` links a web login to the league-owner record it belongs
to. Nullable because most existing owners haven't signed up for the web
app yet; unique because one login should only ever map to one owner.

Revision ID: 3d2a7cf84eb9
Revises: f8b66c486a5e
Create Date: 2026-08-19 07:11:56.953188

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '3d2a7cf84eb9'
down_revision: Union[str, Sequence[str], None] = 'f8b66c486a5e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE users (
            id          SERIAL PRIMARY KEY,
            email       TEXT NOT NULL UNIQUE,
            created_at  TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        ALTER TABLE owners
            ADD COLUMN user_id INT UNIQUE REFERENCES users(id)
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE owners DROP COLUMN user_id")
    op.execute("DROP TABLE users")
