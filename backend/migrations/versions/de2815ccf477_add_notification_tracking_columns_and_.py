"""add notification tracking columns and draft room messages table

Revision ID: de2815ccf477
Revises: 63291a4c50ae
Create Date: 2026-09-05 09:04:29.435319

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'de2815ccf477'
down_revision: Union[str, Sequence[str], None] = '63291a4c50ae'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotency flags for two new scheduled pushes (2026-09, draft
    # night notifications) — same "set once, never re-fire" shape
    # draft_config.starting_soon_notified_at already established, just
    # on the two other real deadlines this feature adds: the keeper
    # selection deadline (30-minute warning) and the pre-draft room
    # actually opening (1 hour before scheduled_start).
    op.execute("ALTER TABLE league_keeper_rules ADD COLUMN deadline_warning_notified_at TIMESTAMPTZ")
    op.execute("ALTER TABLE draft_config ADD COLUMN room_opened_notified_at TIMESTAMPTZ")

    # Draft-room chat (2026-09) — real persisted text messages scoped to
    # one specific draft (season + league_id, same scoping every other
    # draft table uses), so a late-joining or reconnecting owner sees
    # history instead of only whatever arrives over the WebSocket from
    # that point forward. Deliberately NOT the general chat system's
    # conversations/messages tables — this is ephemeral draft-night
    # banter with a much simpler shape (no reactions, mentions, edits,
    # read receipts), and scoping it to a draft rather than a
    # conversation would fight that system's own model rather than
    # reuse it. "Who's online" is NOT stored here at all — that's the
    # existing real-time-only presence system (app/draft/manager.py),
    # unchanged; only actual typed messages persist.
    op.execute(
        """
        CREATE TABLE draft_room_messages (
            id SERIAL PRIMARY KEY,
            season INTEGER NOT NULL,
            league_id INTEGER NOT NULL REFERENCES leagues(id),
            owner_id INTEGER NOT NULL REFERENCES owners(owner_id),
            text TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_draft_room_messages_room ON draft_room_messages (season, league_id, created_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE draft_room_messages")
    op.execute("ALTER TABLE draft_config DROP COLUMN room_opened_notified_at")
    op.execute("ALTER TABLE league_keeper_rules DROP COLUMN deadline_warning_notified_at")
