"""add trades and trade settings tables

Three new tables for the trades feature (see the project plan for full
context): league_trade_settings is one row per (season, league) holding
the commissioner-configured trade_deadline/review_required; trades is
one row per proposed trade between two teams in that league/season;
trade_assets is one row per player moving hands in a trade (a trade can
be N-for-M, so this is a child table rather than fixed give/receive
columns on trades itself).

Follows the same (season, league_id) PK convention as
league_keeper_rules/draft_config, and the same teams_by_season(id) /
players(sleeper_player_id) FK convention current_rosters/draft_picks
already use for team and player references, respectively — not
owner_id or espn_player_id, matching the modern (post-players-table)
foreign-key style.

trades.status is enforced application-side via a CHECK constraint
rather than a separate lookup table, matching current_rosters'
acquired_via / draft_config.status precedent elsewhere in this schema.
resolved_at is set whenever status leaves 'pending'/'awaiting_review'
(accepted immediately, rejected, cancelled, or vetoed) — null while
still awaiting any action.

Revision ID: 699231c06dfa
Revises: df2d949f0c17
Create Date: 2026-09-03 06:19:51.545572

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '699231c06dfa'
down_revision: Union[str, Sequence[str], None] = 'df2d949f0c17'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE league_trade_settings (
            season INTEGER NOT NULL,
            league_id INTEGER NOT NULL DEFAULT 1 REFERENCES leagues(id),
            trade_deadline TIMESTAMPTZ,
            review_required BOOLEAN NOT NULL DEFAULT FALSE,
            PRIMARY KEY (season, league_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE trades (
            id SERIAL PRIMARY KEY,
            league_id INTEGER NOT NULL REFERENCES leagues(id),
            season INTEGER NOT NULL,
            proposing_team_id INTEGER NOT NULL REFERENCES teams_by_season(id),
            receiving_team_id INTEGER NOT NULL REFERENCES teams_by_season(id),
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'awaiting_review', 'accepted', 'rejected', 'cancelled', 'vetoed')),
            proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            resolved_at TIMESTAMPTZ
        )
        """
    )
    op.execute(
        """
        CREATE TABLE trade_assets (
            id SERIAL PRIMARY KEY,
            trade_id INTEGER NOT NULL REFERENCES trades(id),
            sleeper_player_id TEXT NOT NULL REFERENCES players(sleeper_player_id),
            from_team_id INTEGER NOT NULL REFERENCES teams_by_season(id),
            to_team_id INTEGER NOT NULL REFERENCES teams_by_season(id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE trade_assets")
    op.execute("DROP TABLE trades")
    op.execute("DROP TABLE league_trade_settings")
