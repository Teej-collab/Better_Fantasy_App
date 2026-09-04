"""add league_polls and poll_votes tables

A genuinely new feature (2026-09-03 plan) — lets the commissioner ask
league members a question with a fixed set of options and collect
votes, e.g. "should we push the trade deadline back a week?" Nothing
like this existed before (grepped for "poll" across the whole
codebase; every prior hit was about HTTP/websocket polling intervals,
unrelated).

Voting is keyed by user_id, not owner_id — polls are a membership-scoped
feature (one vote per league_members row), same identity league_members
itself already uses, not tied to having a real team/owner row.

options is a plain JSONB array of strings (["Option A", "Option B"]);
poll_votes.option_index references a position in that array rather than
a separate poll_options table — options are fixed at creation time
(this app has no "add an option after votes exist" concept), so there's
nothing a normalized table would buy here that a JSONB array doesn't
already give for free.

Revision ID: c31d8f5a92e7
Revises: a8e34f0c6d21
Create Date: 2026-09-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c31d8f5a92e7'
down_revision: Union[str, Sequence[str], None] = 'a8e34f0c6d21'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE league_polls (
            id SERIAL PRIMARY KEY,
            league_id INTEGER NOT NULL REFERENCES leagues(id),
            question TEXT NOT NULL,
            options JSONB NOT NULL,
            created_by_user_id INTEGER NOT NULL REFERENCES users(id),
            status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            closed_at TIMESTAMPTZ
        )
        """
    )
    op.execute(
        """
        CREATE TABLE poll_votes (
            id SERIAL PRIMARY KEY,
            poll_id INTEGER NOT NULL REFERENCES league_polls(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            option_index INTEGER NOT NULL,
            voted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (poll_id, user_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE poll_votes")
    op.execute("DROP TABLE league_polls")
