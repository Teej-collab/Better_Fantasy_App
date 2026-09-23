"""add owner_users and co_owner_invites tables for shared team ownership

Real ask, 2026-09-22: let a team's owner invite a friend to co-manage
the same team (not a separate team) — both people act as the exact
same owner_id everywhere (chat, push, trades, keepers, settings all
already key off a single owner_id, so this is deliberately a shared
identity, not a distinct second person).

owners.user_id was a single, UNIQUE column — exactly one real login
could ever be linked to a given owner. owner_users replaces it with a
real join table so a second (or third) real login can link to the
SAME owner_id, while UNIQUE(user_id) on this new table preserves the
one invariant every other part of the app still depends on: one real
person can never be linked to more than one owner identity.

owners.user_id is dropped in this same migration, not left around
unused — every reader/writer of that column is updated in the same
change (app/queries/auth.py, app/queries/leagues.py,
app/domain/trades.py, app/queries/chat.py, app/queries/settings.py,
app/queries/admin_overview.py, app/queries/admin_users.py,
app/queries/admin_leagues.py), so there is no dual-write drift window.

co_owner_invites is the redeemable link itself — single-use
(redeemed_at IS NULL required to redeem), same secrets.token_urlsafe(8)
unguessable-code idiom leagues.invite_code already uses, just scoped
to one owner_id instead of one league.

Revision ID: 881d55c71d2a
Revises: 73b78b034f05
Create Date: 2026-09-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = '881d55c71d2a'
down_revision: Union[str, Sequence[str], None] = '73b78b034f05'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE owner_users (
            owner_id   INT NOT NULL REFERENCES owners(owner_id),
            user_id    INT NOT NULL UNIQUE REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (owner_id, user_id)
        )
        """
    )
    op.execute(
        "INSERT INTO owner_users (owner_id, user_id) "
        "SELECT owner_id, user_id FROM owners WHERE user_id IS NOT NULL"
    )
    op.execute("ALTER TABLE owners DROP COLUMN user_id")

    op.execute(
        """
        CREATE TABLE co_owner_invites (
            id                 SERIAL PRIMARY KEY,
            owner_id           INT NOT NULL REFERENCES owners(owner_id),
            invite_code        TEXT NOT NULL UNIQUE,
            created_by_user_id INT NOT NULL REFERENCES users(id),
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            redeemed_by_user_id INT REFERENCES users(id),
            redeemed_at        TIMESTAMPTZ
        )
        """
    )
    op.execute("CREATE INDEX co_owner_invites_owner_id_idx ON co_owner_invites (owner_id)")


def downgrade() -> None:
    op.execute("DROP TABLE co_owner_invites")
    op.execute("ALTER TABLE owners ADD COLUMN user_id INT UNIQUE REFERENCES users(id)")
    op.execute(
        """
        UPDATE owners o SET user_id = ou.user_id
        FROM owner_users ou
        WHERE ou.owner_id = o.owner_id
        """
    )
    op.execute("DROP TABLE owner_users")
