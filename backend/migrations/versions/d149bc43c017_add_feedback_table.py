"""add feedback table

A real in-app feedback mechanism — the owner's own request (2026-09-02),
nothing like this existed anywhere in the app before (no email sending, no
Discord webhook). Deliberately simple: store the submission plus a display
name already resolved at submit time (the same owner-then-users fallback
GET /auth/me already uses — see app/auth/session.py's payload shape and
routers/auth.py's own display_name resolution) so listing feedback later
never needs a join against two different possible identity tables. A real
FK to users(id) (not the "no cross-cluster FK" convention season-scoped
sync tables use) — feedback rows are a permanent record, not resyncable
data, so referential integrity matters here.

Revision ID: d149bc43c017
Revises: e2081957fb6c
Create Date: 2026-09-02 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd149bc43c017'
down_revision: Union[str, Sequence[str], None] = 'e2081957fb6c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE feedback (
            id SERIAL PRIMARY KEY,
            user_id INT NOT NULL REFERENCES users(id),
            submitted_by TEXT NOT NULL,
            message TEXT NOT NULL,
            page_url TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE feedback")
