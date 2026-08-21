"""add owner display name override and chat color

User settings (app/routers/settings.py): a self-serve display name and
a per-owner chat bubble color, shown to everyone in League Chat.

display_name_is_custom, not a second name column: owners.display_name
is already kept current by every ESPN sync (app/providers/espn/adapter.py
upserts it from the real firstName/lastName on every full/live sync,
which runs automatically and frequently during live games) — a second
"custom_display_name" column would need every one of the many existing
"SELECT display_name" call sites across this app (chat, chug, league,
awards, team profile...) updated to prefer it, a wide, error-prone
blast radius for a small feature. A flag instead: sync's upsert now
skips overwriting display_name for any owner whose flag is set, so a
self-serve name survives every future sync. No user-facing name history
is lost either way — ESPN itself remains the durable record of the real
name, so unsetting the flag (not built as an endpoint yet, but trivial
to add) naturally restores it on the next sync rather than needing a
second stored copy here.

chat_color is deliberately free of any format constraint at the
database layer — validated strictly server-side instead (app/routers/
settings.py: `^#[0-9a-fA-F]{6}$` only), since this value reaches the
frontend and gets used in a CSS context (a chat bubble's background) —
a real place unvalidated user input could matter, not just theoretical.

Revision ID: 893534025217
Revises: 7d0d160856d7
Create Date: 2026-08-20 19:30:47.916021

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '893534025217'
down_revision: Union[str, Sequence[str], None] = '7d0d160856d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE owners ADD COLUMN display_name_is_custom BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute("ALTER TABLE owners ADD COLUMN chat_color TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE owners DROP COLUMN chat_color")
    op.execute("ALTER TABLE owners DROP COLUMN display_name_is_custom")
