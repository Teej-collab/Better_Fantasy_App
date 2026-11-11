"""About you: birth year, gender, and the under-13 block

One question per account, asked once after sign-in on every sign-in
path (2026-11-10). The birthday keeps anyone under 13 out (COPPA); only
the year is kept. Gender is male, female or unanswered ("Prefer not to
say"), and the AI writers use it so nobody gets called "he" by default.

- birth_year: the year from the birthday they gave.
- gender: 'male', 'female' or NULL.
- about_you_at: when they answered (gender can stay NULL, so this is
  what says the step is done).
- under_13_at: set when the birthday says under 13. The account is
  signed out and stays locked, so changing the answer doesn't get
  back in.

Revision ID: f6a8c0e2d4b7
Revises: e4f6a8b0c2d5
Create Date: 2026-11-10
"""
from alembic import op

revision = "f6a8c0e2d4b7"
down_revision = "e4f6a8b0c2d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE users
            ADD COLUMN birth_year INTEGER,
            ADD COLUMN gender TEXT CHECK (gender IN ('male', 'female')),
            ADD COLUMN about_you_at TIMESTAMPTZ,
            ADD COLUMN under_13_at TIMESTAMPTZ
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE users
            DROP COLUMN under_13_at,
            DROP COLUMN about_you_at,
            DROP COLUMN gender,
            DROP COLUMN birth_year
        """
    )
