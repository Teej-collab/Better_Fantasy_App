"""add league_playoff_settings table

An explicit, commissioner-editable playoff team count — until now,
queries/league.py's get_playoff_team_count had "no 'how many teams
make the playoffs' setting stored anywhere" (its own docstring),
inferring it only from the most recently COMPLETED prior season's real
bracket. That's a real gap for the CURRENT season's own standings page
(no playoff-picture divider until a prior season's playoffs exist to
infer from) and gives the commissioner no way to actually declare the
format for a season in progress.

One row per (season, league) — deliberately not just per-league, since
a league's playoff field size can genuinely change year to year.
get_playoff_team_count checks this table first and only falls back to
the historical-inference method when no explicit row exists, so every
season that predates this feature keeps behaving exactly as before.

Revision ID: a8e34f0c6d21
Revises: f2a91c4d7b83
Create Date: 2026-09-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a8e34f0c6d21'
down_revision: Union[str, Sequence[str], None] = 'f2a91c4d7b83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE league_playoff_settings (
            season INTEGER NOT NULL,
            league_id INTEGER NOT NULL REFERENCES leagues(id),
            playoff_team_count INTEGER NOT NULL CHECK (playoff_team_count > 0),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (season, league_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE league_playoff_settings")
