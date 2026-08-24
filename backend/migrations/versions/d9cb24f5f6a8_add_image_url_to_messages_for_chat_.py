"""add image_url to messages for chat media attachments

Nullable — most messages stay text-only. Uploads go straight from the
browser to Vercel Blob (see frontend's /api/chat/upload route), so this
column only ever stores the resulting public blob URL, never file bytes.

Revision ID: d9cb24f5f6a8
Revises: 3da680665fb2
Create Date: 2026-08-24 07:58:22.769655

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd9cb24f5f6a8'
down_revision: Union[str, Sequence[str], None] = '3da680665fb2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE messages ADD COLUMN image_url TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE messages DROP COLUMN image_url")
