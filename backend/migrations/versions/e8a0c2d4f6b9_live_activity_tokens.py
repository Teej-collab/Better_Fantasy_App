"""Live Activity tokens (lock-screen and Dynamic Island live score)

The iOS app shows your matchup as a Live Activity on game day. Apple
hands it two kinds of APNs tokens, both stored here:

- kind 'activity': one per running Live Activity. The backend pushes
  score updates to it, and ends it when the matchup is final.
- kind 'start': one per device (iOS 17.2+). Lets the backend start a
  Live Activity itself at kickoff ("push-to-start").

live_activity_remote_starts records each matchup the backend already
started remotely, so a device never gets a second start for the same
matchup.

Revision ID: e8a0c2d4f6b9
Revises: d6f8a0b2c4e7
Create Date: 2026-10-07 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e8a0c2d4f6b9'
down_revision: Union[str, Sequence[str], None] = 'd6f8a0b2c4e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE live_activity_tokens (
            id            SERIAL PRIMARY KEY,
            owner_id      INT NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
            league_id     INT NOT NULL,
            device_id     TEXT NOT NULL,
            kind          TEXT NOT NULL CHECK (kind IN ('activity', 'start')),
            token         TEXT NOT NULL UNIQUE,
            activity_id   TEXT,
            matchup_id    INT,
            last_props    TEXT,
            last_sent_at  TIMESTAMPTZ,
            active        BOOLEAN NOT NULL DEFAULT TRUE,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute(
        "CREATE UNIQUE INDEX live_activity_tokens_one_start_per_device "
        "ON live_activity_tokens (owner_id, device_id) WHERE kind = 'start'"
    )
    op.execute("CREATE INDEX live_activity_tokens_active_idx ON live_activity_tokens (active, kind)")

    op.execute("""
        CREATE TABLE live_activity_remote_starts (
            owner_id    INT NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
            matchup_id  INT NOT NULL,
            started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (owner_id, matchup_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE live_activity_remote_starts")
    op.execute("DROP TABLE live_activity_tokens")
