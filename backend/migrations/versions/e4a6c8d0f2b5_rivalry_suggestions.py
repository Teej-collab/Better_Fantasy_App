"""Rivalry suggestions

app/domain/rivalry_detection.py scores every owner pair in a league
from its history and suggests the strongest ones. The commissioner
approves (they become rivalries rows) or dismisses them; a dismissed
pair is never suggested again.

- owner_a_id < owner_b_id, one row per pair per league.
- reasons: plain lines the commissioner reads ("Met in the 2024
  championship", "8 games, 4-4").
- status: pending -> approved | dismissed.

Revision ID: e4a6c8d0f2b5
Revises: d3f5b7c9e1a4
Create Date: 2026-10-27 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'e4a6c8d0f2b5'
down_revision: Union[str, Sequence[str], None] = 'd3f5b7c9e1a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE rivalry_suggestions (
            id                  SERIAL PRIMARY KEY,
            league_id           INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
            owner_a_id          INT NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
            owner_b_id          INT NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
            score               NUMERIC NOT NULL,
            tier                TEXT NOT NULL,
            reasons             JSONB NOT NULL DEFAULT '[]',
            suggested_name      TEXT,
            suggested_tagline   TEXT,
            status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed')),
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            decided_at          TIMESTAMPTZ,
            decided_by_user_id  INT REFERENCES users(id) ON DELETE SET NULL,
            CHECK (owner_a_id < owner_b_id),
            UNIQUE (league_id, owner_a_id, owner_b_id)
        )
    """)
    op.execute("CREATE INDEX rivalry_suggestions_pending_idx ON rivalry_suggestions (league_id) WHERE status = 'pending'")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS rivalry_suggestions")
