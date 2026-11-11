"""Share links: one public, unguessable link per shared card

The share overhaul (2026-11-10): sharing a matchup, recap, standings,
power rankings or week's awards makes a link anyone can open without
signing in, and the card images and the public page read through it
(app/routers/share.py). One link per league + kind + ref, so sharing
the same thing twice hands back the same link.

Revision ID: a7b9d1f3e5c8
Revises: f6a8c0e2d4b7
Create Date: 2026-11-10
"""
from alembic import op

revision = "a7b9d1f3e5c8"
down_revision = "f6a8c0e2d4b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE share_links (
            token TEXT PRIMARY KEY,
            league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK (kind IN ('matchup', 'recap', 'standings', 'power', 'awards')),
            ref JSONB NOT NULL,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            views INTEGER NOT NULL DEFAULT 0,
            UNIQUE (league_id, kind, ref)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE share_links")
