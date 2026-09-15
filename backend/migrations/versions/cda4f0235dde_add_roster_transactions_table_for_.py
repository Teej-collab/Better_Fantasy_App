"""add roster_transactions table for league activity feed

Every add/drop of every kind (free_agent, waiver, commissioner) already
writes into current_rosters with its own acquired_via/acquired_at — but
a DROP just DELETEs that row with no trace left behind (confirmed:
lineup_engine.drop_player, add_free_agent's drop-to-make-room branch,
waivers.py's claim processing, and commissioner_lineup.py's force-drop
all delete with no history kept). Trades already have their own real
history (trades/trade_assets) and are excluded here on purpose — this
table is only for the add/drop paths that had nothing.

One row per real user action (not per player): added_sleeper_player_id
and dropped_sleeper_player_id are both nullable, and exactly one of the
three states applies per row (add-only, drop-only, or swap-both) — a
single "added X, dropped Y" roster move is one action, one row, not two
independently-timestamped events that would need correlating back
together later.

Revision ID: cda4f0235dde
Revises: 6b3e8a1f9c4d
Create Date: 2026-09-15 14:26:38.806606

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'cda4f0235dde'
down_revision: Union[str, Sequence[str], None] = '6b3e8a1f9c4d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE roster_transactions (
            id SERIAL PRIMARY KEY,
            season INTEGER NOT NULL,
            league_id INTEGER NOT NULL DEFAULT 1 REFERENCES leagues(id),
            team_id INTEGER NOT NULL REFERENCES teams_by_season(id),
            added_sleeper_player_id TEXT REFERENCES players(sleeper_player_id),
            dropped_sleeper_player_id TEXT REFERENCES players(sleeper_player_id),
            source TEXT NOT NULL CHECK (source IN ('free_agent', 'waiver', 'commissioner')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CHECK (added_sleeper_player_id IS NOT NULL OR dropped_sleeper_player_id IS NOT NULL)
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_roster_transactions_feed ON roster_transactions (season, league_id, created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX ix_roster_transactions_feed")
    op.execute("DROP TABLE roster_transactions")
