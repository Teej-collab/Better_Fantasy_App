"""chat v2: conversations, participants, reactions, mentions

Evolves the single-room chat (messages: id/owner_id/body/created_at,
from earlier today) into a real conversation model: one shared league
conversation plus 1:1 direct conversations, with replies, soft
deletes, reactions, and mentions. `messages` had zero real rows in
production at the time of this migration (confirmed before writing
it), so this is additive/structural, not a data-preserving migration.

This app has no `leagues` table (single-league; Phase 9 multi-league
work hasn't started) — "the league conversation" is one row, not
scoped by a league_id that doesn't exist yet.

Revision ID: 03417db98bb5
Revises: 4b492f773650
Create Date: 2026-08-20 11:44:44.241341

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '03417db98bb5'
down_revision: Union[str, Sequence[str], None] = '4b492f773650'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE conversations (
            id              SERIAL PRIMARY KEY,
            type            TEXT NOT NULL CHECK (type IN ('league', 'direct')),
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE conversation_participants (
            conversation_id         INT NOT NULL REFERENCES conversations(id),
            owner_id                INT NOT NULL REFERENCES owners(owner_id),
            last_read_message_id    INT,
            PRIMARY KEY (conversation_id, owner_id)
        )
    """)

    op.execute("ALTER TABLE messages ADD COLUMN conversation_id INT REFERENCES conversations(id)")
    op.execute("ALTER TABLE messages ADD COLUMN reply_to_id INT REFERENCES messages(id)")
    op.execute("ALTER TABLE messages ADD COLUMN deleted_at TIMESTAMPTZ")
    op.execute("CREATE INDEX idx_messages_conversation_id ON messages (conversation_id, created_at)")

    op.execute("""
        CREATE TABLE message_reactions (
            id              SERIAL PRIMARY KEY,
            message_id      INT NOT NULL REFERENCES messages(id),
            owner_id        INT NOT NULL REFERENCES owners(owner_id),
            emoji           TEXT NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (message_id, owner_id, emoji)
        )
    """)

    op.execute("""
        CREATE TABLE message_mentions (
            message_id      INT NOT NULL REFERENCES messages(id),
            owner_id        INT NOT NULL REFERENCES owners(owner_id),
            PRIMARY KEY (message_id, owner_id)
        )
    """)

    # Seed the one league-wide conversation and its current participants —
    # every owner with a team in what's actually the active season at
    # migration time. MAX(season) stands in for ACTIVE_SEASON here since
    # this is a one-time SQL seed with no access to the app's env config;
    # in practice they're the same season, same caveat app/domain/your_week.py
    # already documents for a similar MAX(season) situation.
    op.execute("INSERT INTO conversations (type) VALUES ('league')")
    op.execute("""
        INSERT INTO conversation_participants (conversation_id, owner_id)
        SELECT (SELECT id FROM conversations WHERE type = 'league'), t.owner_id
        FROM teams_by_season t
        WHERE t.season = (SELECT MAX(season) FROM teams_by_season)
        GROUP BY t.owner_id
    """)


def downgrade() -> None:
    op.execute("DROP TABLE message_mentions")
    op.execute("DROP TABLE message_reactions")
    op.execute("DROP INDEX idx_messages_conversation_id")
    op.execute("ALTER TABLE messages DROP COLUMN deleted_at")
    op.execute("ALTER TABLE messages DROP COLUMN reply_to_id")
    op.execute("ALTER TABLE messages DROP COLUMN conversation_id")
    op.execute("DROP TABLE conversation_participants")
    op.execute("DROP TABLE conversations")
