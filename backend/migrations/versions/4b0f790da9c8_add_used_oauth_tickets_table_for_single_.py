"""add used_oauth_tickets table for single-use native oauth ticket redemption

Enforces single-use redemption for the native OAuth completion ticket
(app/routers/auth.py's redeem_native_oauth_ticket) — a real requirement,
not speculative hardening: a 30-day session token must never be
mintable twice from one intercepted 60-second ticket. Records only
REDEEMED tickets, not issued ones — a ticket's JWT signature already
proves the server issued it (see app/auth/session.py's
decode_ticket_token), so there is nothing to gain from also tracking
issuance, only redemption. jti is PRIMARY KEY specifically so the
INSERT itself is the atomicity guarantee against a race between two
concurrent redemption attempts of the same ticket (the second INSERT
fails with a unique-violation, not a read-then-write check that could
race) — see redeem_native_oauth_ticket's own docstring.

No cleanup job for old rows in this phase — tickets expire in 60
seconds and native OAuth login volume is tiny, so this table grows
extremely slowly; a periodic purge of rows past their ticket's own
expiry is real future work if volume ever justifies it, not something
to build ahead of that need (deferred to Phase 2 — see
docs/NATIVE_PHASE_1_IMPLEMENTATION.md's Known Limitations).

Revision ID: 4b0f790da9c8
Revises: 796e33a7e4dd
Create Date: 2026-09-21 14:32:49.745033

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '4b0f790da9c8'
down_revision: Union[str, Sequence[str], None] = '796e33a7e4dd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE used_oauth_tickets (
            jti         TEXT PRIMARY KEY,
            redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE used_oauth_tickets")
