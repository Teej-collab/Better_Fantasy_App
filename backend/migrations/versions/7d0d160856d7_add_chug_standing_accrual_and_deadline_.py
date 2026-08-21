"""add chug standing, accrual, and deadline settlement tables

Real "Jeffrey's Rule" deadline enforcement (see app/domain/chug_standing.py,
app/domain/chug_deadline.py) — a running per-owner chug balance that
doubles if not paid down by Monday Night Football kickoff (up to 3
consecutive misses, after which the remaining balance converts to a
$10/chug fine that only a commissioner can clear), separate from a
"lifetime chugs completed" count that a real chug always adds to
regardless of whether anything was owed.

Three tables, three distinct concerns:
- chug_standing: the single mutable "what does this owner owe RIGHT
  NOW" per season — outstanding_owed (still payable by completing a
  real chug) and fined_owed (converted to cash, only clearable by a
  commissioner marking it paid). chug_debts (existing table) stays
  exactly as it was — the immutable historical record of each week's
  auto-computed base debt from real roster performance; chug_standing
  is the derived running total built from it.
- chug_debt_accruals: tracks how much of each week's chug_debts value
  has already been folded into chug_standing.outstanding_owed, so
  re-running the accrual step every sync is idempotent and safely
  picks up stat corrections (chugs_owed changing after the fact)
  without double-counting.
- chug_deadline_settlements: one row per (season, week, owner) the
  moment the Monday-night deadline check actually runs for them — both
  an idempotency marker (never double/fine the same week twice) and an
  audit trail of what happened (doubled / fined / no_debt / paid_in_full).

Revision ID: 7d0d160856d7
Revises: 03417db98bb5
Create Date: 2026-08-20 18:49:25.629874

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '7d0d160856d7'
down_revision: Union[str, Sequence[str], None] = '03417db98bb5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE chug_standing (
            id                          SERIAL PRIMARY KEY,
            season                      INT NOT NULL,
            owner_id                    INT NOT NULL REFERENCES owners(owner_id),
            outstanding_owed            INT NOT NULL DEFAULT 0,
            fined_owed                  INT NOT NULL DEFAULT 0,
            consecutive_missed_weeks    INT NOT NULL DEFAULT 0,
            updated_at                  TIMESTAMPTZ DEFAULT now(),
            UNIQUE (season, owner_id)
        )
    """)

    op.execute("""
        CREATE TABLE chug_debt_accruals (
            id              SERIAL PRIMARY KEY,
            season          INT NOT NULL,
            week            INT NOT NULL,
            owner_id        INT NOT NULL REFERENCES owners(owner_id),
            applied_amount  INT NOT NULL DEFAULT 0,
            UNIQUE (season, week, owner_id)
        )
    """)

    op.execute("""
        CREATE TABLE chug_deadline_settlements (
            id              SERIAL PRIMARY KEY,
            season          INT NOT NULL,
            week            INT NOT NULL,
            owner_id        INT NOT NULL REFERENCES owners(owner_id),
            owed_before     INT NOT NULL,
            action          TEXT NOT NULL,
            owed_after      INT NOT NULL,
            settled_at      TIMESTAMPTZ DEFAULT now(),
            UNIQUE (season, week, owner_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE chug_deadline_settlements")
    op.execute("DROP TABLE chug_debt_accruals")
    op.execute("DROP TABLE chug_standing")
