"""add team_position_rankings table for defense-vs-position matchup stat

ESPN's own "mPositionalRatings" view already flows through this app's
existing sync (espn_api's League._get_positional_ratings, called
internally by league.box_scores/free_agents, which
ESPNProvider.sync_rosters(_for_week) already invokes every live-sync
poll) — this table is what actually persists it instead of letting
BoxPlayer.pro_pos_rank/pro_opponent get computed and discarded on the
floor every sync, per app/providers/espn/adapter.py's own _save_lineup.

One row per (team, position, week) rather than per player: every
player at a given position facing the same real NFL defense shares
one rank, so this stays normalized instead of duplicating the same
number onto every roster/free-agent row — callers join it at request
time the same way app/domain/nfl_schedule.py already joins next_opponent,
not by storing it on players/rosters directly.

position is one of 'QB'|'RB'|'WR'|'TE'|'K' — scoped to the app's own
locked-in decision to surface this stat for offensive skill positions
plus kicker, not D/ST (a defense's own "matchup rank" doesn't map onto
this same concept). rank/average_allowed are exactly what ESPN's own
API returns (rank 1 = fewest fantasy points allowed to that position =
toughest matchup, confirmed against live data during planning — not
assumed).

Revision ID: 465f0b1ffe3f
Revises: 9d2f2fea3c3e
Create Date: 2026-09-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '465f0b1ffe3f'
down_revision: Union[str, Sequence[str], None] = '9d2f2fea3c3e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE team_position_rankings (
            season INT NOT NULL,
            week INT NOT NULL,
            pro_team TEXT NOT NULL,
            position TEXT NOT NULL
                CONSTRAINT team_position_rankings_position_check
                CHECK (position IN ('QB', 'RB', 'WR', 'TE', 'K')),
            rank INT NOT NULL,
            average_allowed NUMERIC NOT NULL,
            PRIMARY KEY (season, week, pro_team, position)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE team_position_rankings")
