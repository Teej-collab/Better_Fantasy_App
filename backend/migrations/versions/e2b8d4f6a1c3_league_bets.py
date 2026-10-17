"""League Bets: tails, reactions and follows

- bet_tails: someone tailed a league-mate's shared bet. Tailing saves a
  copy of the picks as the tailer's own bet (tail_bet_id, private like
  any new bet, with no wager); this row is what "Tailed by" and Most
  Tailed count. Deleting the copy removes the tail.
- bet_reactions: Fade (you're betting against it), Sweat (you're
  watching it with them) and RIP (on a busted one). One of each per
  person per bet.
- bet_follows: "Ping me when they bet": a push to the follower whenever
  that person shares a bet.
- An index for reading a league's shared bets.

Purely additive: no existing table changes.

Revision ID: e2b8d4f6a1c3
Revises: c7f3a9d2e4b6
Create Date: 2026-10-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'e2b8d4f6a1c3'
down_revision: Union[str, Sequence[str], None] = 'c7f3a9d2e4b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE bet_tails (
            bet_id INTEGER NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            tail_bet_id INTEGER NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (bet_id, user_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE bet_reactions (
            bet_id INTEGER NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK (kind IN ('fade', 'sweat', 'rip')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (bet_id, user_id, kind)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE bet_follows (
            follower_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (follower_user_id, target_user_id),
            CHECK (follower_user_id <> target_user_id)
        )
        """
    )
    op.execute("CREATE INDEX bet_follows_target_idx ON bet_follows (target_user_id)")
    op.execute("CREATE INDEX bets_league_shared_idx ON bets (league_id, created_at DESC) WHERE shared_at IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS bets_league_shared_idx")
    op.execute("DROP TABLE IF EXISTS bet_follows")
    op.execute("DROP TABLE IF EXISTS bet_reactions")
    op.execute("DROP TABLE IF EXISTS bet_tails")
