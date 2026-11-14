"""TV devices: pairing codes and one session per paired TV

The Weekend TV (2026-11-14): a Chromecast shows a short code, you type
it on the website, and the TV gets its own read-only session
(app/routers/tv.py). Each TV is one tv_devices row, so one TV can be
disconnected without signing anything else out.

Revision ID: c2e4a6b8d0f1
Revises: b8c0e2f4a6d9
Create Date: 2026-11-14
"""
from alembic import op

revision = "c2e4a6b8d0f1"
down_revision = "b8c0e2f4a6d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE tv_devices (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_seen_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ
        )
        """
    )
    op.execute("CREATE INDEX tv_devices_user_idx ON tv_devices (user_id)")
    op.execute(
        """
        CREATE TABLE tv_pairing_codes (
            code TEXT PRIMARY KEY,
            device_code_hash TEXT NOT NULL UNIQUE,
            device_name TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at TIMESTAMPTZ NOT NULL,
            approved_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            approved_at TIMESTAMPTZ,
            redeemed_at TIMESTAMPTZ,
            device_id INTEGER REFERENCES tv_devices(id) ON DELETE CASCADE
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE tv_pairing_codes")
    op.execute("DROP TABLE tv_devices")
