"""projection engine tables

The in-house projection engine (app/domain/projections/, 2026-11-05).
Points are never projected directly: every source — this app's own
model, Sleeper's and ESPN's public projections — is stored as a
projected STAT LINE, and each league scores those stat lines with its
own rules, so a projection is right for any scoring.

- nfl_player_weeks: real weekly NFL stat lines (Sleeper's public stats
  feed), the model's history. No FK to players: history covers players
  this app has never synced.
- nfl_game_lines: Vegas spread/total per team per week (ESPN's public
  scoreboard), turned into each team's implied points.
- projection_lines: one projected stat line per player, week and
  source ('model', 'sleeper', 'espn'), plus the probabilities a
  threshold rule needs (300-yard games, D/ST points-allowed tiers…) and
  the floor/ceiling ratios from the same simulation.
- league_player_projections: each league's own projected points per
  player and week (the blend, and each source's own number).
- projection_accuracy: how far each source missed, by week and
  position, once the week is final. The blend's weights come from here.

Revision ID: e5a7c9b1d3f2
Revises: d4f6a8c0e2b1
Create Date: 2026-11-05 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e5a7c9b1d3f2'
down_revision: Union[str, Sequence[str], None] = 'd4f6a8c0e2b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE nfl_player_weeks (
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            sleeper_player_id TEXT NOT NULL,
            position TEXT,
            team TEXT,
            opponent TEXT,
            stats JSONB NOT NULL DEFAULT '{}',
            synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (season, week, sleeper_player_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE nfl_game_lines (
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            team TEXT NOT NULL,
            opponent TEXT NOT NULL,
            is_home BOOLEAN NOT NULL,
            spread NUMERIC,
            total NUMERIC,
            implied_points NUMERIC,
            synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (season, week, team)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE projection_lines (
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            sleeper_player_id TEXT NOT NULL,
            source TEXT NOT NULL CHECK (source IN ('model', 'sleeper', 'espn')),
            position TEXT,
            line JSONB NOT NULL,
            probs JSONB NOT NULL DEFAULT '{}',
            floor_ratio NUMERIC,
            ceiling_ratio NUMERIC,
            computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (season, week, sleeper_player_id, source)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE league_player_projections (
            league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            sleeper_player_id TEXT NOT NULL,
            projected_points NUMERIC NOT NULL,
            floor_points NUMERIC,
            ceiling_points NUMERIC,
            by_source JSONB NOT NULL DEFAULT '{}',
            computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (league_id, season, week, sleeper_player_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE projection_accuracy (
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            source TEXT NOT NULL,
            position TEXT NOT NULL,
            players INTEGER NOT NULL,
            mae NUMERIC NOT NULL,
            bias NUMERIC NOT NULL,
            rank_corr NUMERIC,
            computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (season, week, source, position)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE projection_accuracy")
    op.execute("DROP TABLE league_player_projections")
    op.execute("DROP TABLE projection_lines")
    op.execute("DROP TABLE nfl_game_lines")
    op.execute("DROP TABLE nfl_player_weeks")
