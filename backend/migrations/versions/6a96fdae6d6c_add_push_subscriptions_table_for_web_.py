"""add push_subscriptions table for web push notifications

One row per browser/device the owner has enabled push on — endpoint is
UNIQUE (not owner_id), so re-subscribing the same browser (e.g. after
clearing permission and re-enabling) upserts the existing row instead
of accumulating duplicates, and a device can only ever belong to one
owner at a time. active lets a failed/expired push (410 Gone from the
provider) be marked dead without deleting history immediately — see
app/queries/push_subscriptions.py's mark_delivery_failed.

Also adds the notification-category columns owner_preferences was
already carrying UI placeholders for (see frontend's
NotificationsSection.tsx, built earlier this session with these exact
toggles disabled and labeled "Coming soon") — push_enabled is the
master switch, the rest are per-category opt-outs. Sensible-not-
everything-on defaults: game alerts and my-team activity default on
(the reason someone would want this feature at all), league
announcements default on (low volume), my-players default OFF (higher
volume/more granular, worth an explicit opt-in) — mirrors the "don't
enable every possible notification by default" instruction directly.

Revision ID: 6a96fdae6d6c
Revises: ff83e77662c3
Create Date: 2026-08-24 15:09:05.940104

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '6a96fdae6d6c'
down_revision: Union[str, Sequence[str], None] = 'ff83e77662c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE push_subscriptions (
            id                          SERIAL PRIMARY KEY,
            owner_id                    INTEGER NOT NULL REFERENCES owners(owner_id),
            endpoint                    TEXT NOT NULL UNIQUE,
            p256dh                      TEXT NOT NULL,
            auth                        TEXT NOT NULL,
            device_label                TEXT,
            active                      BOOLEAN NOT NULL DEFAULT TRUE,
            created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_successful_delivery_at TIMESTAMPTZ,
            last_failure_at             TIMESTAMPTZ
        )
        """
    )
    op.execute("CREATE INDEX idx_push_subscriptions_owner_id ON push_subscriptions (owner_id) WHERE active")

    op.execute("ALTER TABLE owner_preferences ADD COLUMN push_enabled BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute("ALTER TABLE owner_preferences ADD COLUMN notify_game_alerts BOOLEAN NOT NULL DEFAULT TRUE")
    op.execute("ALTER TABLE owner_preferences ADD COLUMN notify_my_players BOOLEAN NOT NULL DEFAULT FALSE")
    op.execute("ALTER TABLE owner_preferences ADD COLUMN notify_fantasy_team BOOLEAN NOT NULL DEFAULT TRUE")
    op.execute("ALTER TABLE owner_preferences ADD COLUMN notify_league BOOLEAN NOT NULL DEFAULT TRUE")


def downgrade() -> None:
    op.execute("ALTER TABLE owner_preferences DROP COLUMN notify_league")
    op.execute("ALTER TABLE owner_preferences DROP COLUMN notify_fantasy_team")
    op.execute("ALTER TABLE owner_preferences DROP COLUMN notify_my_players")
    op.execute("ALTER TABLE owner_preferences DROP COLUMN notify_game_alerts")
    op.execute("ALTER TABLE owner_preferences DROP COLUMN push_enabled")
    op.execute("DROP TABLE push_subscriptions")
