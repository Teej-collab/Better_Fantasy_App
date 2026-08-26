"""drop unique constraint on players espn_player_id

A real first-ingestion run against Sleeper's actual data hit
UniqueViolationError on espn_player_id — Sleeper isn't guaranteed 1:1 on
that crosswalk field (some real players have more than one Sleeper
entry, e.g. legacy/duplicate records, that share the same espn_id).
This column is a convenience crosswalk for cross-referencing this app's
existing ESPN-era historical data, not players' identity in this table
(sleeper_player_id, the primary key, is), so it doesn't need to be
unique — keep it indexed for lookups, drop the uniqueness requirement.

Revision ID: 67495dc50f68
Revises: eedfda2cf6fb
Create Date: 2026-08-26 14:59:27.440468

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '67495dc50f68'
down_revision: Union[str, Sequence[str], None] = 'eedfda2cf6fb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE players DROP CONSTRAINT players_espn_player_id_key")
    op.execute("CREATE INDEX players_espn_player_id_idx ON players (espn_player_id)")


def downgrade() -> None:
    op.execute("DROP INDEX players_espn_player_id_idx")
    op.execute("ALTER TABLE players ADD CONSTRAINT players_espn_player_id_key UNIQUE (espn_player_id)")
