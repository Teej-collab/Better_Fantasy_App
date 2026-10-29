"""File shared bets under their league

A bet logged before its owner had an active league kept league_id NULL,
and sharing it later posted the card to the league chat without filing
the bet under that league. League Bets and the Lounge read bets by
league, so those shared bets never showed up for anyone else (the
2026-10 "couldn't see Ian's bets" report). Sharing now sets league_id;
this files the ones already shared, using the league of the chat their
card was posted in.

Revision ID: c8e1a3f5b7d9
Revises: b5d7f9a1c3e6
Create Date: 2026-10-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'c8e1a3f5b7d9'
down_revision: Union[str, Sequence[str], None] = 'b5d7f9a1c3e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE bets b
        SET league_id = c.league_id
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id AND c.type = 'league'
        WHERE m.bet_id = b.id
          AND b.league_id IS NULL
          AND b.shared_at IS NOT NULL
          AND c.league_id IS NOT NULL
        """
    )


def downgrade() -> None:
    # Which rows were NULL before isn't recorded; a filed bet stays filed.
    pass
