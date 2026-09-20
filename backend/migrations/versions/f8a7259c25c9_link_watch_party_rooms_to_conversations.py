"""link watch_party_rooms to conversations for Phase 3 chat integration

Phase 3 of the Watch Party plan: each room's text chat reuses the
existing chat infrastructure (conversations/conversation_participants/
messages tables, the same WebSocket, MessageBubble/MessageComposer)
instead of a second chat system. Adds 'watch_party' as a real
conversations.type value (same pattern as migration e47b2a91c5d8,
which did this exact drop/recreate for 'commish_corner') and a
conversation_id column on watch_party_rooms pointing at the linked
thread — set going forward by app/queries/watch_party.py whenever a
room is created; NULL for any room created before this migration
(none exist yet in practice, but nullable rather than backfilled
since there's nothing real to backfill it with).

A watch_party-typed conversation is deliberately excluded from the
main Chat tab's conversation list (see the matching change in
app/queries/chat.py's list_conversations_for_owner) — it's reached
through the room itself, not as a second entry next to it.

Revision ID: f8a7259c25c9
Revises: fb735a50fe67
Create Date: 2026-09-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f8a7259c25c9'
down_revision: Union[str, Sequence[str], None] = 'fb735a50fe67'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE conversations DROP CONSTRAINT conversations_type_check")
    op.execute(
        """
        ALTER TABLE conversations ADD CONSTRAINT conversations_type_check
        CHECK (type IN ('league', 'direct', 'commish_corner', 'watch_party'))
        """
    )
    op.execute(
        "ALTER TABLE watch_party_rooms ADD COLUMN conversation_id INTEGER REFERENCES conversations(id)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE watch_party_rooms DROP COLUMN conversation_id")
    op.execute("ALTER TABLE conversations DROP CONSTRAINT conversations_type_check")
    op.execute(
        """
        ALTER TABLE conversations ADD CONSTRAINT conversations_type_check
        CHECK (type IN ('league', 'direct', 'commish_corner'))
        """
    )
