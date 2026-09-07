"""add player_weekly_projections table for real per-week ESPN projections

players.projected_points/projected_avg_points (a3c7e2f9b1d4, 761a416f35f7)
are season-long numbers with no week dimension — every roster/matchup
view has always shown the same "projection" for every week of the
season, because there was nowhere to store a different one. This adds
that missing week dimension.

Real per-week projections are NOT obtainable from the ESPN call this
app already uses for season projections (league.player_info() —
confirmed live, 2026-09: it only ever returns a season-rollup entry,
never a per-week breakdown, for any player type). They ARE obtainable
from league.box_scores(week) — a DIFFERENT call, already made every
sync cycle by app/providers/espn/adapter.py's roster sync (today only
to populate the legacy, ESPN-native `rosters` table) — via
BoxPlayer.projected_points, matched to this app's real players by
BoxPlayer.playerId == players.espn_player_id (confirmed reliable, no
name-matching needed).

Real, structural limitation (measured live against the real 2026
draft, not assumed): box_scores(week) only contains players who happen
to be rostered somewhere in ESPN's own separate, disconnected fake
league that week — 159 of 192 real draft picks (82.8%) for week 1.
This is a genuine partial-coverage data source, not a bug — reads
against this table must COALESCE onto players.projected_avg_points
(100% coverage, confirmed) as the fallback for the uncovered ~17%,
which will shift week to week.

No league_id — matches current_rosters' established convention; this
data is ESPN's global per-player-per-week number, not scoped to any
one fantasy league.

Revision ID: 3ced9294bbeb
Revises: e8bedf1ab4b9
Create Date: 2026-09-07 21:45:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '3ced9294bbeb'
down_revision: Union[str, Sequence[str], None] = 'e8bedf1ab4b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE player_weekly_projections (
            id SERIAL PRIMARY KEY,
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            sleeper_player_id TEXT NOT NULL REFERENCES players(sleeper_player_id),
            projected_points NUMERIC NOT NULL,
            synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (season, week, sleeper_player_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE player_weekly_projections")
