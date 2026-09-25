"""add league_espn_connections table for per-league ESPN sync

Revision ID: 0abe0690feb3
Revises: d7a3f1c8e5b2
Create Date: 2026-09-25 11:10:59.394011

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0abe0690feb3'
down_revision: Union[str, Sequence[str], None] = 'd7a3f1c8e5b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Phase 6 of the multi-league migration (see TODO.md's PHASE 9
    entry) — lets a league other than League #1 connect its own real
    ESPN league and sync it independently, instead of ESPN_LEAGUE_ID/
    ESPN_S2/ESPN_SWID only ever being able to describe one global
    league. One connection per league_id (PRIMARY KEY, not a separate
    SERIAL id + UNIQUE constraint) — this table only ever needs to
    answer "does this league have a connection, and what is it," never
    "list every connection a league has ever had."

    espn_s2_encrypted/espn_swid_encrypted hold Fernet ciphertext (see
    app/encryption.py), not plaintext — ESPN_S2 in particular is a
    long-lived ESPN auth cookie, the first real per-user credential
    this app has ever stored in its own database rather than only ever
    reading from an env var. connected_by_user_id is ON DELETE SET
    NULL, not CASCADE: the connection (and the synced ESPN data it
    produced) should outlive the specific commissioner who happened to
    set it up, e.g. if they later delete their account.
    """
    op.execute("""
        CREATE TABLE league_espn_connections (
            league_id             INT NOT NULL PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
            espn_league_id        INT NOT NULL,
            espn_s2_encrypted     TEXT NOT NULL,
            espn_swid_encrypted   TEXT NOT NULL,
            connected_by_user_id  INT REFERENCES users(id) ON DELETE SET NULL,
            created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_synced_at        TIMESTAMPTZ,
            last_sync_error       TEXT
        )
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP TABLE league_espn_connections")
