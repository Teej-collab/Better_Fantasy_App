"""add native_push_tokens table for native push notifications

The APNs/FCM analog of push_subscriptions (migration 6a96fdae6d6c) — one
row per (owner, device) a native iOS/Android client has registered for
push, additive to and entirely independent of that table (Web Push/
VAPID keeps working unchanged; this is a second, parallel delivery
channel, not a replacement — see docs/NATIVE_PHASE_1_DATABASE.md).

Two unique constraints, for two different real-world reassignment
cases, same reasoning push_subscriptions' own UNIQUE(endpoint) already
established for the VAPID case:
  - (owner_id, device_id): the upsert target. Handles token rotation
    (same device gets a new OS-issued token — one row, updated in
    place) and multiple devices per owner (a different device_id is
    simply a new row).
  - push_token, but only WHERE active (a partial unique index, same
    idea as idx_native_push_tokens_owner_id below): catches the OS
    handing an identical opaque token to a reinstalled app now logged
    into a DIFFERENT account — without this, that device could keep
    receiving pushes meant for the previous account. The query layer
    (app/queries/native_push_tokens.py) deactivates any stale
    (owner_id, device_id) match on push_token before upserting on
    (owner_id, device_id), since one INSERT can only target one ON
    CONFLICT constraint — scoping the uniqueness to WHERE active is
    what lets that deactivated row keep its old push_token value
    (soft-deleted, not scrubbed, matching this table's own "never hard-
    delete" convention) without it colliding with the token's new
    active owner. A plain, unconditional UNIQUE(push_token) would
    reject that reassignment outright, since the deactivated row would
    still be occupying the value.

platform gets a real DB-level CHECK (unlike analytics_events.platform,
which enforces its allowlist in Python) because this value directly
selects which provider (APNs vs FCM) the dispatcher sends through — a
bad value here is a delivery-routing bug, not just a data-quality one.

No account-deletion cleanup exists for this table, same as
push_subscriptions today (confirmed: no existing code path deletes
push_subscriptions rows on account deletion either) — this is a
pre-existing gap this table inherits, not a new one it introduces; both
tables should get real cleanup together whenever that's built.

Revision ID: 796e33a7e4dd
Revises: f8a7259c25c9
Create Date: 2026-09-21 14:26:22.458876

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '796e33a7e4dd'
down_revision: Union[str, Sequence[str], None] = 'f8a7259c25c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE native_push_tokens (
            id                          SERIAL PRIMARY KEY,
            owner_id                    INTEGER NOT NULL REFERENCES owners(owner_id),
            device_id                   TEXT NOT NULL,
            platform                    TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
            push_token                  TEXT NOT NULL,
            app_version                 TEXT,
            os_version                  TEXT,
            active                      BOOLEAN NOT NULL DEFAULT TRUE,
            created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_seen_at                TIMESTAMPTZ,
            last_successful_delivery_at TIMESTAMPTZ,
            last_failure_at             TIMESTAMPTZ
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX idx_native_push_tokens_owner_device ON native_push_tokens (owner_id, device_id)"
    )
    op.execute(
        "CREATE UNIQUE INDEX idx_native_push_tokens_push_token ON native_push_tokens (push_token) WHERE active"
    )
    op.execute(
        "CREATE INDEX idx_native_push_tokens_owner_id ON native_push_tokens (owner_id) WHERE active"
    )


def downgrade() -> None:
    op.execute("DROP TABLE native_push_tokens")
