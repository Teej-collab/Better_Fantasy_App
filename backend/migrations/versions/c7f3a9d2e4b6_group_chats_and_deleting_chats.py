"""group chats, and deleting a chat from your own list

- conversations.type gains 'group': a chat with any set of league
  members, started from New Message (app/routers/chat.py). It belongs
  to the league it was started in, like the league chat.
- conversations.name: an optional name for a group. Unnamed groups
  show their members' names.
- conversation_participants.hidden: you deleted the chat, so it's off
  your list. The next message anyone sends un-hides it.
- conversation_participants.cleared_message_id: the last message you
  deleted along with it. You only see newer messages, like Messages.

Purely additive: nothing changes for existing chats.

Revision ID: c7f3a9d2e4b6
Revises: b5e1d7a3c9f2
Create Date: 2026-10-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'c7f3a9d2e4b6'
down_revision: Union[str, Sequence[str], None] = 'b5e1d7a3c9f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE conversations DROP CONSTRAINT conversations_type_check")
    op.execute(
        """
        ALTER TABLE conversations ADD CONSTRAINT conversations_type_check
        CHECK (type IN ('league', 'direct', 'commish_corner', 'watch_party', 'group'))
        """
    )
    op.execute("ALTER TABLE conversations ADD COLUMN name TEXT")
    op.execute("ALTER TABLE conversation_participants ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute("ALTER TABLE conversation_participants ADD COLUMN cleared_message_id INTEGER")


def downgrade() -> None:
    op.execute("ALTER TABLE conversation_participants DROP COLUMN cleared_message_id")
    op.execute("ALTER TABLE conversation_participants DROP COLUMN hidden")
    op.execute("ALTER TABLE conversations DROP COLUMN name")
    op.execute("ALTER TABLE conversations DROP CONSTRAINT conversations_type_check")
    op.execute(
        """
        ALTER TABLE conversations ADD CONSTRAINT conversations_type_check
        CHECK (type IN ('league', 'direct', 'commish_corner', 'watch_party'))
        """
    )
