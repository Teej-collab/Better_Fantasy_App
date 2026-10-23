"""Trades overhaul: the trade block, and drops that ride along with a trade

- trade_block: players their owner says they'd move. Listed from the
  Trades page; anyone in the league sees them there. A row whose player
  has since left that roster is simply ignored when read.
- trade_drops: who a team cuts to make room when a trade brings in more
  players than it sends out. The proposer picks theirs when sending the
  offer, the receiver when accepting; they're dropped at the moment the
  trade goes through, not before.

Purely additive: two new tables.

Revision ID: e6a1c9d3b7f2
Revises: d5e2b8c4f1a6
Create Date: 2026-10-23 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'e6a1c9d3b7f2'
down_revision: Union[str, Sequence[str], None] = 'd5e2b8c4f1a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE trade_block (
            league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
            season INTEGER NOT NULL,
            team_id INTEGER NOT NULL REFERENCES teams_by_season(id) ON DELETE CASCADE,
            sleeper_player_id TEXT NOT NULL REFERENCES players(sleeper_player_id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (team_id, sleeper_player_id)
        )
        """
    )
    op.execute("CREATE INDEX idx_trade_block_league ON trade_block (league_id, season)")
    op.execute(
        """
        CREATE TABLE trade_drops (
            trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
            team_id INTEGER NOT NULL REFERENCES teams_by_season(id) ON DELETE CASCADE,
            sleeper_player_id TEXT NOT NULL REFERENCES players(sleeper_player_id),
            PRIMARY KEY (trade_id, sleeper_player_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE trade_drops")
    op.execute("DROP TABLE trade_block")
