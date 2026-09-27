"""add injury/news alerts and working quiet hours

- owner_preferences.notify_injuries: a rostered player's injury status
  changed (new injury, upgrade, downgrade, cleared, hurt in a game).
  On by default.
- owner_preferences.notify_player_news: a new ESPN news blurb about a
  rostered player with no status change. On by default (commissioner's
  call, 2026-09-27: start on, owners turn it off if it gets noisy).
- owner_preferences.timezone: the IANA zone quiet hours are read in,
  set from the owner's own device by Settings > Notifications. NULL
  means America/Chicago, the league's home zone.
- player_injury_status: the last injury status seen for each player in
  ESPN's league-wide injuries feed — the "before" side of the diff the
  injury watch job (app/notifications/injury_events.py) runs.
- deferred_notifications: pushes held during an owner's quiet hours,
  sent once they end (app/notifications/dispatcher.py).
- live_injury_status.notified_state: the in-game state already pushed
  to owners, so each change is announced once. Backfilled to the
  current state so this week's existing rows don't all fire on deploy.

Purely additive apart from that backfill.

Revision ID: f3a9c1e5b7d2
Revises: e8b4c2d17a90
Create Date: 2026-09-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'f3a9c1e5b7d2'
down_revision: Union[str, Sequence[str], None] = 'e8b4c2d17a90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE owner_preferences ADD COLUMN notify_injuries BOOLEAN NOT NULL DEFAULT TRUE")
    op.execute("ALTER TABLE owner_preferences ADD COLUMN notify_player_news BOOLEAN NOT NULL DEFAULT TRUE")
    op.execute("ALTER TABLE owner_preferences ADD COLUMN timezone TEXT")
    op.execute(
        """
        CREATE TABLE player_injury_status (
            sleeper_player_id TEXT PRIMARY KEY REFERENCES players(sleeper_player_id),
            status TEXT NOT NULL,
            injury TEXT,
            news_id TEXT,
            news_at TIMESTAMPTZ,
            detail TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE deferred_notifications (
            id SERIAL PRIMARY KEY,
            owner_id INTEGER NOT NULL REFERENCES owners(owner_id),
            payload JSONB NOT NULL,
            send_after TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX idx_deferred_notifications_send_after ON deferred_notifications (send_after)")
    op.execute("ALTER TABLE live_injury_status ADD COLUMN notified_state TEXT")
    op.execute("UPDATE live_injury_status SET notified_state = state")


def downgrade() -> None:
    op.execute("ALTER TABLE live_injury_status DROP COLUMN notified_state")
    op.execute("DROP TABLE deferred_notifications")
    op.execute("DROP TABLE player_injury_status")
    op.execute("ALTER TABLE owner_preferences DROP COLUMN timezone")
    op.execute("ALTER TABLE owner_preferences DROP COLUMN notify_player_news")
    op.execute("ALTER TABLE owner_preferences DROP COLUMN notify_injuries")
