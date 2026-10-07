"""App Store readiness: Sign in with Apple, chat report/block, and
per-league house rules

Three things Apple checks at review (2026-10):

- users.apple_user_id — Sign in with Apple, required once an app offers
  Google or Discord sign-in. Apple's "sub" claim is a string, like
  Google's (see 9c4e1a2f7b3d).
- owner_blocks / message_reports — apps with user-generated content
  must let people block abusive users and report objectionable content.
  A block hides the blocked owner's messages from the blocker and stops
  pushes from them; a report reaches the site admins.
- leagues.chug_enabled / chug_rule_name — the chug rule was League #1's
  own tradition but showed up in every league. It's now a house rule a
  commissioner turns on and names. Off for new leagues; on, with its
  existing name, for League #1 (where it started) and any league that
  already has chug history.

Revision ID: d6f8a0b2c4e7
Revises: c4e6a8b0d2f5
Create Date: 2026-10-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd6f8a0b2c4e7'
down_revision: Union[str, Sequence[str], None] = 'c4e6a8b0d2f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN apple_user_id TEXT UNIQUE")

    op.execute("""
        CREATE TABLE owner_blocks (
            blocker_owner_id  INT NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
            blocked_owner_id  INT NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (blocker_owner_id, blocked_owner_id),
            CHECK (blocker_owner_id <> blocked_owner_id)
        )
    """)
    op.execute("CREATE INDEX owner_blocks_blocked_idx ON owner_blocks (blocked_owner_id)")

    op.execute("""
        CREATE TABLE message_reports (
            id                 SERIAL PRIMARY KEY,
            message_id         INT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            reporter_owner_id  INT NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
            reason             TEXT NOT NULL,
            details            TEXT,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            resolved_at        TIMESTAMPTZ,
            UNIQUE (message_id, reporter_owner_id)
        )
    """)

    op.execute("ALTER TABLE leagues ADD COLUMN chug_enabled BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute("ALTER TABLE leagues ADD COLUMN chug_rule_name TEXT")
    op.execute("""
        UPDATE leagues SET chug_enabled = TRUE, chug_rule_name = 'Jeffrey''s Rule'
        WHERE id = 1 OR id IN (SELECT DISTINCT league_id FROM chug_debts)
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE leagues DROP COLUMN chug_rule_name")
    op.execute("ALTER TABLE leagues DROP COLUMN chug_enabled")
    op.execute("DROP TABLE message_reports")
    op.execute("DROP TABLE owner_blocks")
    op.execute("ALTER TABLE users DROP COLUMN apple_user_id")
