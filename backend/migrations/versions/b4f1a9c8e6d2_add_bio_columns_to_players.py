"""add bio columns to players

Player-card feature: Sleeper's raw player payload already carries age,
height, weight, jersey number, and years of NFL experience — Phase A's
initial ingestion (see eedfda2cf6fb) only kept the fields the draft
pool/autopick needed and dropped these on the floor. Adding them now so
app/providers/sleeper/ingest.py can persist them for the new player
card UI, matching the bio strip shown on a normal Sleeper/ESPN player
page (age/height/weight/jersey/exp) — see TODO.md.

height/weight are kept as TEXT, not INTEGER: Sleeper's raw values are
already display-ready strings ("6'1\"" is NOT what Sleeper sends —
Sleeper actually sends height in total inches as a string, e.g. "73",
and weight in lbs as a string, e.g. "202" — kept as TEXT anyway since
some entries (e.g. DEF, or a player mid-season-signing) can be null or
have historically carried non-numeric placeholder values in Sleeper's
own data, and this app does no arithmetic on either field, only
displays them.

Revision ID: b4f1a9c8e6d2
Revises: fcd0e76ead34
Create Date: 2026-08-26 18:45:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b4f1a9c8e6d2'
down_revision: Union[str, Sequence[str], None] = 'fcd0e76ead34'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE players
            ADD COLUMN age INTEGER,
            ADD COLUMN height TEXT,
            ADD COLUMN weight TEXT,
            ADD COLUMN jersey_number TEXT,
            ADD COLUMN years_exp INTEGER
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE players
            DROP COLUMN age,
            DROP COLUMN height,
            DROP COLUMN weight,
            DROP COLUMN jersey_number,
            DROP COLUMN years_exp
        """
    )
