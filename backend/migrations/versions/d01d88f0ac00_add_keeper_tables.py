"""add keeper tables

Two new tables for keeper-league tracking (see the project plan for full
context): league_keeper_rules is one row per season holding the
commissioner-configured max_keepers/max_consecutive_years/deadline/lock
state; keeper_selections is one row per (season, owner, player) an owner
has designated as a keeper for that season.

espn_player_id is the identity key for "is this the same player kept
again next year" — the same nullable ESPN player id already added to
rosters in 21d0b5e0ae06, not player_name text (ESPN's own text
formatting isn't guaranteed stable year to year). consecutive_years_kept
lets Part E's carryover logic enforce max_consecutive_years without a
separate lookup table.

espn_synced_at is null until a real, verified write to ESPN succeeds
for that row (see ESPN_KEEPER_WRITE.md) — never set optimistically.

Per-owner max_keepers/deadline/lock enforcement lives in
app/routers/keepers.py, not as DB constraints — the same "validation in
the router, not the database" convention owner_preferences/settings.py
already use for this app's other per-owner preference data.

Revision ID: d01d88f0ac00
Revises: 4be9ca6f4491
Create Date: 2026-08-25 21:20:52.193974

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd01d88f0ac00'
down_revision: Union[str, Sequence[str], None] = '4be9ca6f4491'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE league_keeper_rules (
            season INTEGER PRIMARY KEY,
            max_keepers INTEGER NOT NULL,
            max_consecutive_years INTEGER,
            keeper_deadline TIMESTAMPTZ,
            locked_at TIMESTAMPTZ
        )
        """
    )
    op.execute(
        """
        CREATE TABLE keeper_selections (
            id SERIAL PRIMARY KEY,
            season INTEGER NOT NULL,
            owner_id INTEGER NOT NULL REFERENCES owners(owner_id),
            espn_player_id INTEGER NOT NULL,
            player_name TEXT NOT NULL,
            consecutive_years_kept INTEGER NOT NULL DEFAULT 1,
            espn_synced_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (season, owner_id, espn_player_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE keeper_selections")
    op.execute("DROP TABLE league_keeper_rules")
