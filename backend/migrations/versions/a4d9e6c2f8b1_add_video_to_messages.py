"""add video to messages

A video posted to chat (app/domain/chat_video.py): {"key",
"poster_key", "width", "height", "duration"}, the bucket keys of the
H.264 MP4 and its poster frame plus what the player needs to size
itself before it loads. Nullable: almost every message has none.
Purely additive.

Revision ID: a4d9e6c2f8b1
Revises: e2b7c9d4f1a6
Create Date: 2026-10-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'a4d9e6c2f8b1'
down_revision: Union[str, Sequence[str], None] = 'e2b7c9d4f1a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE messages ADD COLUMN video JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE messages DROP COLUMN video")
