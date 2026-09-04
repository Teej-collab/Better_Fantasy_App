"""add is_admin to users for independent admin access

Site-admin access (the /admin/* dashboard) used to be entirely implicit
— League #1's commissioner, full stop (is_site_owner on /auth/me). The
owner asked for a real way to grant it to someone else (Niko) without
also handing them full League #1 commissioner power, which is a much
bigger grant than "can see the usage dashboard." users.is_admin is
that independent flag: is_site_owner is now (League #1 commissioner)
OR (is_admin) — either one is sufficient, neither is required — see
app/auth/league_context.py's require_site_admin.

On users, not owners: user_id is the one identity every real account
has regardless of league/owner linkage (see app/routers/auth.py's own
/me handler comment on this), and admin access is a property of the
ACCOUNT, not of a specific league's roster entry.

Backfills the real, current site owner's own account so this migration
can never lock them out — the two of you are already trusted; this
migration doesn't grant anyone new, it exposes the same access as a
manageable, revocable flag.

Revision ID: aa47e92ad5fe
Revises: c8ca9b06b451
Create Date: 2026-09-04

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'aa47e92ad5fe'
down_revision: Union[str, Sequence[str], None] = 'c8ca9b06b451'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE")
    # Backfill: every user who is DEFAULT_LEAGUE_ID's commissioner
    # today already has admin access via is_site_owner's other clause —
    # marking them is_admin too is a no-op in effect, just makes the
    # grant visible/manageable as a real row instead of only ever
    # inferred from league role.
    op.execute(
        """
        UPDATE users SET is_admin = TRUE
        WHERE id IN (
            SELECT user_id FROM league_members WHERE league_id = 1 AND role = 'commissioner'
        )
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN is_admin")
