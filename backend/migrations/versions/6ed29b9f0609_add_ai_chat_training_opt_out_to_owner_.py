"""add ai chat training opt-out to owner_preferences

The AI shit-talk-learning feature itself is still not built (declined
earlier this session — see the chat overhaul plan's own note on it) —
this is just the consent infrastructure for it, added ahead of time so
the warning shown before a member's first-ever chat send has something
real to persist. Opt-OUT model per the owner's explicit instruction:
ai_training_opt_out defaults to false (opted IN — messages CAN be used
once the feature exists) for every owner, current and future, matching
this table's own "missing == default" discipline (see accent_color's
migration 4254e9a81de3 for the same pattern). ai_training_notice_seen
tracks whether this owner has already been shown the one-time warning
that lets them opt out — separate from the choice itself, since "seen
and chose to stay opted in" and "never seen it yet" must read
differently to the frontend (the first-send interception in
MessageComposer.tsx checks this, not ai_training_opt_out, to decide
whether to show the warning at all).

Revision ID: 6ed29b9f0609
Revises: e47b2a91c5d8
Create Date: 2026-09-04 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '6ed29b9f0609'
down_revision: Union[str, Sequence[str], None] = 'e47b2a91c5d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE owner_preferences ADD COLUMN ai_training_opt_out BOOLEAN NOT NULL DEFAULT false")
    op.execute("ALTER TABLE owner_preferences ADD COLUMN ai_training_notice_seen BOOLEAN NOT NULL DEFAULT false")


def downgrade() -> None:
    op.execute("ALTER TABLE owner_preferences DROP COLUMN ai_training_opt_out")
    op.execute("ALTER TABLE owner_preferences DROP COLUMN ai_training_notice_seen")
