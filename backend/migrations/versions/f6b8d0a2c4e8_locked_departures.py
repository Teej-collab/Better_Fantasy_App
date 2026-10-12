"""locked departures

Revision ID: f6b8d0a2c4e8
Revises: e5a7c9b1d3f6
Create Date: 2026-10-12

A starter whose game already kicked off this week, then left the roster
(a waiver claim's drop, a drop, a trade), keeps scoring for that team in
that week's lineup slot — ESPN's rule. Real report 2026-10-12: a Monday
3am waiver claim dropped the Dallas D/ST that had started and played
Sunday, and its points left the week-5 matchup with it. See
app/domain/locked_departures.py.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'f6b8d0a2c4e8'
down_revision: Union[str, Sequence[str], None] = 'e5a7c9b1d3f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE locked_departures (
            season              INT NOT NULL,
            week                INT NOT NULL,
            league_id           INT NOT NULL REFERENCES leagues(id),
            team_id             INT NOT NULL REFERENCES teams_by_season(id),
            sleeper_player_id   TEXT NOT NULL REFERENCES players(sleeper_player_id),
            lineup_slot         TEXT NOT NULL,
            departed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (season, week, team_id, sleeper_player_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE locked_departures")
