"""add chug_adjustments

Every change a commissioner or site admin makes to someone's chug
balance by hand, so the chug history (app/domain/chug_ledger.py) can
label it for what it was instead of an unexplained "correction":

- 'paid': chugs settled outside the app ("Paid" — $10 a chug, or done
  in person with no video). `amount` > 0, taken off outstanding_owed.
- 'fine_paid': a fine paid off. `amount` > 0 fined chugs cleared from
  fined_owed.
- 'correction': a straight fix to the balance, either way. `amount` is
  signed (+ adds chugs, - removes them); `note` says why.

Removing a deadline doubling is already recorded by its settlement row
(chug_deadline_settlements.action = 'waived').

Revision ID: e9c4a1b7d3f2
Revises: d7a2c4e8f1b9
Create Date: 2026-10-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e9c4a1b7d3f2'
down_revision: Union[str, Sequence[str], None] = 'd7a2c4e8f1b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE chug_adjustments (
            id SERIAL PRIMARY KEY,
            season INTEGER NOT NULL,
            owner_id INTEGER NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
            league_id INTEGER NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('paid', 'fine_paid', 'correction')),
            amount INTEGER NOT NULL CHECK (amount <> 0),
            note TEXT,
            recorded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX chug_adjustments_season_idx ON chug_adjustments (league_id, season, owner_id)")


def downgrade() -> None:
    op.execute("DROP TABLE chug_adjustments")
