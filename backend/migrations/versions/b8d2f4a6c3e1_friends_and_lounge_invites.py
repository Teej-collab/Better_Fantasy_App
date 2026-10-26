"""Friends and Lounge invites

- users.username: an optional handle people can find you by. Unique
  regardless of case.
- friendships: one row per friend request, from requester to addressee;
  status 'pending' until the addressee accepts. A pair is friends when
  either direction's row is 'accepted'. Plain columns (no LEAST/GREATEST
  index or ordering check) so app/domain/account_link.py's generic
  user-id move still works on it.
- lounge_room_invites: friends a Lounge room's host invited. An invited
  friend joins without the room's password.

Purely additive: one column, two tables.

Revision ID: b8d2f4a6c3e1
Revises: a7c3e9f1d2b4
Create Date: 2026-10-26 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'b8d2f4a6c3e1'
down_revision: Union[str, Sequence[str], None] = 'a7c3e9f1d2b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN username TEXT")
    op.execute("CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username))")
    op.execute("""
        CREATE TABLE friendships (
            requester_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            addressee_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            accepted_at   TIMESTAMPTZ,
            PRIMARY KEY (requester_id, addressee_id)
        )
    """)
    op.execute("CREATE INDEX friendships_addressee_idx ON friendships (addressee_id)")
    op.execute("""
        CREATE TABLE lounge_room_invites (
            room_id     INT NOT NULL REFERENCES lounge_rooms(id) ON DELETE CASCADE,
            user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            invited_by  INT REFERENCES users(id) ON DELETE SET NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (room_id, user_id)
        )
    """)
    op.execute("CREATE INDEX lounge_room_invites_user_idx ON lounge_room_invites (user_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS lounge_room_invites")
    op.execute("DROP TABLE IF EXISTS friendships")
    op.execute("DROP INDEX IF EXISTS users_username_lower_idx")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS username")
