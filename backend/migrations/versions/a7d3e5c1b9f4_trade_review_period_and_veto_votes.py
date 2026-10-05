"""trade review period, veto votes, offer expiry

Trades used to go through the instant the other owner tapped Accept
(unless the commissioner had turned on "review required"), with no
waiting period and no way for the league to object. Real report,
2026-10-04: a trade went through with nobody notified and no review at
all. This adds the ESPN/Sleeper model:

- league_trade_settings.review_mode — 'none' (process on accept),
  'commissioner' (a review period the commissioner can veto during),
  'league_vote' (a review period where the rest of the league can vote
  to veto; the commissioner still can too), or 'approval' (waits for
  the commissioner to approve — what review_required=TRUE meant).
  Existing leagues get 'commissioner' — the reported league had none —
  or 'approval' where review_required was on. review_required itself
  stays for the code that predates this.
- review_hours (default 24) and veto_votes_needed (NULL = a third of the
  league's teams, rounded up).
- trades: status 'in_review' (accepted, waiting out the review period,
  until review_ends_at), 'expired' (an offer nobody answered before
  expires_at), and 'failed' (rosters changed so it could no longer go
  through when it came up for processing); an optional note.
- trade_veto_votes — one row per team voting to veto a trade.

Revision ID: a7d3e5c1b9f4
Revises: f2b6d1a9c4e7
Create Date: 2026-10-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a7d3e5c1b9f4'
down_revision: Union[str, Sequence[str], None] = 'f2b6d1a9c4e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE league_trade_settings
            ADD COLUMN review_mode TEXT NOT NULL DEFAULT 'commissioner'
                CHECK (review_mode IN ('none', 'commissioner', 'league_vote', 'approval')),
            ADD COLUMN review_hours INTEGER NOT NULL DEFAULT 24 CHECK (review_hours BETWEEN 0 AND 168),
            ADD COLUMN veto_votes_needed INTEGER CHECK (veto_votes_needed >= 1)
        """
    )
    op.execute("UPDATE league_trade_settings SET review_mode = 'approval' WHERE review_required")
    op.execute("ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_status_check")
    op.execute(
        """
        ALTER TABLE trades
            ADD CONSTRAINT trades_status_check CHECK (status IN (
                'pending', 'awaiting_review', 'in_review', 'accepted', 'rejected',
                'cancelled', 'vetoed', 'expired', 'failed'
            )),
            ADD COLUMN accepted_at TIMESTAMPTZ,
            ADD COLUMN review_ends_at TIMESTAMPTZ,
            ADD COLUMN expires_at TIMESTAMPTZ,
            ADD COLUMN note TEXT CHECK (char_length(note) <= 280)
        """
    )
    op.execute("CREATE INDEX trades_due_idx ON trades (status, review_ends_at) WHERE status = 'in_review'")
    op.execute(
        """
        CREATE TABLE trade_veto_votes (
            trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
            team_id INTEGER NOT NULL REFERENCES teams_by_season(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (trade_id, team_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE trade_veto_votes")
    op.execute("DROP INDEX trades_due_idx")
    op.execute(
        "UPDATE trades SET status = 'awaiting_review' WHERE status = 'in_review'"
    )
    op.execute("UPDATE trades SET status = 'cancelled' WHERE status IN ('expired', 'failed')")
    op.execute("ALTER TABLE trades DROP CONSTRAINT trades_status_check")
    op.execute(
        """
        ALTER TABLE trades
            ADD CONSTRAINT trades_status_check CHECK (status IN (
                'pending', 'awaiting_review', 'accepted', 'rejected', 'cancelled', 'vetoed'
            )),
            DROP COLUMN accepted_at,
            DROP COLUMN review_ends_at,
            DROP COLUMN expires_at,
            DROP COLUMN note
        """
    )
    op.execute(
        "ALTER TABLE league_trade_settings DROP COLUMN review_mode, DROP COLUMN review_hours, DROP COLUMN veto_votes_needed"
    )
