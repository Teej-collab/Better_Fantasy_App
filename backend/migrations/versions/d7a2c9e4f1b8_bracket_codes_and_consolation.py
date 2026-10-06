"""playoff bracket: game codes and the consolation ladder

The bracket is now described by app/domain/playoffs.py's bracket_spec —
every game has a code (SF1, F, 3RD, C1..C8) and belongs to the winners'
bracket or the consolation ladder (down to the Toilet Bowl). Games are
filled and advanced by code, not by round/slot position, since the
ladder routes losers as well as winners.

Revision ID: d7a2c9e4f1b8
Revises: c4f1a8d2e6b3
Create Date: 2026-10-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd7a2c9e4f1b8'
down_revision: Union[str, Sequence[str], None] = 'c4f1a8d2e6b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE playoff_bracket_matchups
            ADD COLUMN code TEXT,
            ADD COLUMN bracket TEXT NOT NULL DEFAULT 'winners' CHECK (bracket IN ('winners', 'consolation'))
        """
    )
    # The consolation ladder reuses round/slot numbers, so a game is
    # unique per bracket, not per round/slot.
    op.execute(
        """
        ALTER TABLE playoff_bracket_matchups
            DROP CONSTRAINT playoff_bracket_matchups_season_league_id_round_slot_key,
            ADD CONSTRAINT playoff_bracket_matchups_season_league_bracket_round_slot_key
                UNIQUE (season, league_id, bracket, round, slot)
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX playoff_bracket_matchups_code_uniq "
        "ON playoff_bracket_matchups (season, league_id, code) WHERE code IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS playoff_bracket_matchups_code_uniq")
    op.execute(
        """
        ALTER TABLE playoff_bracket_matchups
            DROP CONSTRAINT playoff_bracket_matchups_season_league_bracket_round_slot_key,
            ADD CONSTRAINT playoff_bracket_matchups_season_league_id_round_slot_key UNIQUE (season, league_id, round, slot)
        """
    )
    op.execute("ALTER TABLE playoff_bracket_matchups DROP COLUMN code, DROP COLUMN bracket")
