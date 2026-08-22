"""add owner_preferences table for notifications, chat, and appearance settings

One row per owner, created lazily on first write (see
app/queries/owner_preferences.py's get-or-default read) rather than
backfilled for every existing owner — every column has a real default,
so a missing row and a row full of defaults are equivalent to every
reader. Deliberately one wide table instead of three narrow ones
(notifications/chat/appearance): all three are the exact same shape
(one row per owner, small set of per-owner flags), and splitting them
would only mean three near-identical get-or-default queries instead of
one.

sunday_mode is nullable text, not an enum — NULL means "customized"
(the user hand-edited a Messages toggle after applying a preset), not
"unset"; every owner effectively starts on the 'full_send' default
(all four notify_* columns default TRUE) without needing the column
itself to default to a string.

Revision ID: 3da680665fb2
Revises: 21d0b5e0ae06
Create Date: 2026-08-22 09:10:18.743534

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '3da680665fb2'
down_revision: Union[str, Sequence[str], None] = '21d0b5e0ae06'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE owner_preferences (
            owner_id INTEGER PRIMARY KEY REFERENCES owners(owner_id),

            notify_direct_messages BOOLEAN NOT NULL DEFAULT TRUE,
            notify_league_chat BOOLEAN NOT NULL DEFAULT TRUE,
            notify_mentions BOOLEAN NOT NULL DEFAULT TRUE,
            notify_replies BOOLEAN NOT NULL DEFAULT TRUE,
            sunday_mode TEXT,

            quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            quiet_hours_start TIME NOT NULL DEFAULT '22:00',
            quiet_hours_end TIME NOT NULL DEFAULT '08:00',

            read_receipts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            typing_indicators_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            message_previews_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            mention_highlighting_enabled BOOLEAN NOT NULL DEFAULT TRUE,

            neon_intensity TEXT NOT NULL DEFAULT 'standard',
            reduced_motion BOOLEAN NOT NULL DEFAULT FALSE,

            CONSTRAINT owner_preferences_sunday_mode_check
                CHECK (sunday_mode IN ('full_send', 'game_day', 'leave_me_alone') OR sunday_mode IS NULL),
            CONSTRAINT owner_preferences_neon_intensity_check
                CHECK (neon_intensity IN ('subtle', 'standard', 'high'))
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE owner_preferences")
