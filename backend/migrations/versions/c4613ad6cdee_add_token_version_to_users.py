"""add token_version to users for real session revocation

Security fix (2026-09 audit) — sessions are signed JWTs with no
server-side state at all, so logout only ever cleared the cookie
client-side; a copied/leaked token stayed fully valid for its whole
30-day life regardless of logout or account deletion. This column is
the minimal state needed to change that: every session token now
carries the token_version it was issued with, checked against this
column on every request (app/main.py's session_revocation middleware,
not a per-route change — see that file's own comment for why a single
middleware choke point was chosen over touching the ~19 individual
route call sites that decode a session token today). Bumping a user's
token_version invalidates every token issued before that moment at
once — used by POST /auth/logout, so logout finally means something
server-side, not just "this one cookie is gone."

DEFAULT 1 matches create_session_token's own new default token_version
claim, so every session token already in a visitor's browser before
this migration runs keeps working seamlessly after deploy — nothing
about this is a forced logout of the whole league.

Revision ID: c4613ad6cdee
Revises: b4d8f1c2e6a9
Create Date: 2026-09-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c4613ad6cdee'
down_revision: Union[str, Sequence[str], None] = 'b4d8f1c2e6a9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN token_version")
