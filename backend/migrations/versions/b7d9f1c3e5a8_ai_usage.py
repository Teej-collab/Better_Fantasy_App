"""AI usage

One row per AI call (app/ai_usage.py): which feature and league it was
for, its tokens and its dollar cost, so Admin > AI Costs shows real
spend per league.

Revision ID: b7d9f1c3e5a8
Revises: a6c8e0b2d4f7
Create Date: 2026-10-28 05:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'b7d9f1c3e5a8'
down_revision: Union[str, Sequence[str], None] = 'a6c8e0b2d4f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE ai_usage (
            id                  BIGSERIAL PRIMARY KEY,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            feature             TEXT NOT NULL,
            league_id           INT REFERENCES leagues(id) ON DELETE SET NULL,
            model               TEXT NOT NULL,
            input_tokens        INT NOT NULL DEFAULT 0,
            output_tokens       INT NOT NULL DEFAULT 0,
            cache_read_tokens   INT NOT NULL DEFAULT 0,
            cache_write_tokens  INT NOT NULL DEFAULT 0,
            cost_usd            NUMERIC(12, 6) NOT NULL DEFAULT 0,
            stop_reason         TEXT
        )
    """)
    op.execute("CREATE INDEX ai_usage_created_idx ON ai_usage (created_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS ai_usage")
