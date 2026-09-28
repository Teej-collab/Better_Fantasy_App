"""add app_errors, security_events, admin_audit_log

Three append-only tables behind the admin dashboard's Errors, Security,
and Audit Log pages (ADMIN_DASHBOARD.md):

- app_errors: JavaScript errors reported by users' browsers/phones
  (frontend/src/lib/errorReporter.ts) and unhandled backend errors / 5xx
  responses (app/monitoring.py's middleware). `fingerprint` groups
  repeats of the same error so the dashboard shows one row per bug.
- security_events: failed sign-ins, blocked (403) requests, and rate-
  limit (429) hits, with the caller's IP.
- admin_audit_log: every successful admin-dashboard/admin-tool change
  (granting admin, deleting a user or team, triggering a sync...).

Owner/user references are ON DELETE SET NULL so deleting an account
never fails on, or silently erases, its monitoring history.

Revision ID: b4d8e2f6a1c3
Revises: a7c3e9f1d4b6
Create Date: 2026-09-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b4d8e2f6a1c3'
down_revision: Union[str, Sequence[str], None] = 'a7c3e9f1d4b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE app_errors (
            id BIGSERIAL PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            source TEXT NOT NULL CHECK (source IN ('client', 'server')),
            fingerprint TEXT NOT NULL,
            message TEXT NOT NULL,
            stack TEXT,
            route TEXT,
            method TEXT,
            status_code INT,
            owner_id INT REFERENCES owners(owner_id) ON DELETE SET NULL,
            user_id INT REFERENCES users(id) ON DELETE SET NULL,
            platform TEXT,
            os TEXT,
            screen TEXT
        )
        """
    )
    op.execute("CREATE INDEX app_errors_created_at_idx ON app_errors (created_at)")
    op.execute("CREATE INDEX app_errors_fingerprint_idx ON app_errors (fingerprint, created_at)")

    op.execute(
        """
        CREATE TABLE security_events (
            id BIGSERIAL PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            kind TEXT NOT NULL,
            user_id INT REFERENCES users(id) ON DELETE SET NULL,
            email TEXT,
            ip TEXT,
            method TEXT,
            path TEXT,
            detail TEXT,
            user_agent TEXT
        )
        """
    )
    op.execute("CREATE INDEX security_events_created_at_idx ON security_events (created_at)")
    op.execute("CREATE INDEX security_events_kind_idx ON security_events (kind, created_at)")
    op.execute("CREATE INDEX security_events_ip_idx ON security_events (ip, created_at)")

    op.execute(
        """
        CREATE TABLE admin_audit_log (
            id BIGSERIAL PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            actor_user_id INT REFERENCES users(id) ON DELETE SET NULL,
            action TEXT NOT NULL,
            method TEXT NOT NULL,
            path TEXT NOT NULL,
            target TEXT,
            status_code INT NOT NULL
        )
        """
    )
    op.execute("CREATE INDEX admin_audit_log_created_at_idx ON admin_audit_log (created_at)")


def downgrade() -> None:
    op.execute("DROP TABLE admin_audit_log")
    op.execute("DROP TABLE security_events")
    op.execute("DROP TABLE app_errors")
