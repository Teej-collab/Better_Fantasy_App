"""Punishment Wheel

punishment_wheel_items: what's on a league's wheel for a season.
Commissioners and site admins add and remove them until it's spun.

season_punishments: the spin — once per league per season. The server
picks where it lands (so nobody can rig it and every phone animates to
the same answer), and keeps the wheel exactly as it was at that moment
(items_snapshot) so anyone opening it later can watch the same spin.

Revision ID: d4f6a8c0e2b5
Revises: c3d5f7a9b1e4
Create Date: 2026-10-07 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd4f6a8c0e2b5'
down_revision: Union[str, Sequence[str], None] = 'c3d5f7a9b1e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE punishment_wheel_items (
            id                SERIAL PRIMARY KEY,
            league_id         INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
            season            INT NOT NULL,
            text              TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 80),
            added_by_user_id  INT REFERENCES users(id) ON DELETE SET NULL,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX punishment_wheel_items_league_season ON punishment_wheel_items (league_id, season)")
    op.execute("""
        CREATE TABLE season_punishments (
            league_id         INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
            season            INT NOT NULL,
            text              TEXT NOT NULL,
            landed_index      INT NOT NULL,
            items_snapshot    JSONB NOT NULL,
            spun_by_user_id   INT REFERENCES users(id) ON DELETE SET NULL,
            spun_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (league_id, season)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE season_punishments")
    op.execute("DROP TABLE punishment_wheel_items")
