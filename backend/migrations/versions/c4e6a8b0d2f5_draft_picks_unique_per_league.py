"""draft_picks: one player per season PER LEAGUE

draft_picks_one_player_per_season was (season, sleeper_player_id) —
from before there was more than one league — so the moment a second
league drafted, any player already taken in another league's draft
failed with a unique violation. current_rosters was already widened to
(season, sleeper_player_id, league_id); this matches it. Only relaxes
the constraint; no rows change.

Revision ID: c4e6a8b0d2f5
Revises: b3d5f7a9c2e4
Create Date: 2026-10-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c4e6a8b0d2f5'
down_revision: Union[str, Sequence[str], None] = 'b3d5f7a9c2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX draft_picks_one_player_per_season")
    op.execute(
        "CREATE UNIQUE INDEX draft_picks_one_player_per_season ON draft_picks (season, league_id, sleeper_player_id) "
        "WHERE sleeper_player_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX draft_picks_one_player_per_season")
    op.execute(
        "CREATE UNIQUE INDEX draft_picks_one_player_per_season ON draft_picks (season, sleeper_player_id) "
        "WHERE sleeper_player_id IS NOT NULL"
    )
