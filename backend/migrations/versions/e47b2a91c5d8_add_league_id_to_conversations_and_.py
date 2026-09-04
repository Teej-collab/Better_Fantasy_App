"""add league_id to conversations and a commish_corner conversation type

Chat predates multi-league support (03417db98bb5, 2026-08-20) and was
never migrated when leagues/league_members landed 11 days later
(454d8edda612) — "the league conversation" has been one single global
row for the whole app this whole time, and DM-eligibility
(list_eligible_members) is scoped only by season, not by league. This
fixes that the same way 454d8edda612 fixed every other fantasy-league-
scoped table: a column-only, backfilled, non-breaking ADD COLUMN with
DEFAULT 1 — see that migration's own docstring for why DEFAULT 1 is a
deliberate bridge, not a permanent default, and why it's safe even
though today's domain code doesn't set it explicitly on every insert
yet (app/queries/chat.py is updated in the same change as this
migration to start doing so for league/commish_corner conversations).

league_id is meaningful for 'league' and 'commish_corner' conversations
(the real scope every reader/writer below cares about) but currently
UNUSED for 'direct' conversations — a DM is between two owners
regardless of which league(s) they happen to share, and nothing reads
league_id for that type. Giving direct conversations league_id=1 by
default here is harmless (matches 454d8edda612's own "DEFAULT 1 as a
temporary bridge" reasoning) rather than meaningful.

Also extends conversations.type to allow 'commish_corner' — a new
per-league, commissioner-only-post, everyone-can-react conversation
(2026-09-04 plan) — and backfills one for every league that doesn't
already have one (today, just League #1; league_context.py's
create_league is updated in the same change to seed one automatically
for every league created from here on).

Revision ID: e47b2a91c5d8
Revises: c31d8f5a92e7
Create Date: 2026-09-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e47b2a91c5d8'
down_revision: Union[str, Sequence[str], None] = 'c31d8f5a92e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE conversations ADD COLUMN league_id INT NOT NULL DEFAULT 1 REFERENCES leagues(id)")

    op.execute("ALTER TABLE conversations DROP CONSTRAINT conversations_type_check")
    op.execute(
        "ALTER TABLE conversations ADD CONSTRAINT conversations_type_check "
        "CHECK (type IN ('league', 'direct', 'commish_corner'))"
    )

    # Backfill: one commish_corner conversation per existing league that
    # doesn't already have one (idempotent — safe to re-run).
    op.execute(
        """
        INSERT INTO conversations (type, league_id)
        SELECT 'commish_corner', l.id FROM leagues l
        WHERE NOT EXISTS (
            SELECT 1 FROM conversations c WHERE c.type = 'commish_corner' AND c.league_id = l.id
        )
        """
    )
    # Participants = real current league_members, resolved to owner_id
    # via owners.user_id (chat is owner_id-keyed; league_members is
    # user_id-keyed — same join leagues.py's own get_membership-adjacent
    # queries already use). An owner with no linked user_id (never
    # signed up / claimed their history) has no way to actually sign in
    # and use chat, so is correctly excluded here, not a bug.
    op.execute(
        """
        INSERT INTO conversation_participants (conversation_id, owner_id)
        SELECT c.id, o.owner_id
        FROM conversations c
        JOIN league_members lm ON lm.league_id = c.league_id
        JOIN owners o ON o.user_id = lm.user_id
        WHERE c.type = 'commish_corner'
          AND NOT EXISTS (
            SELECT 1 FROM conversation_participants cp
            WHERE cp.conversation_id = c.id AND cp.owner_id = o.owner_id
          )
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE type = 'commish_corner'))")
    op.execute("DELETE FROM message_mentions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE type = 'commish_corner'))")
    op.execute("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE type = 'commish_corner')")
    op.execute("DELETE FROM conversation_participants WHERE conversation_id IN (SELECT id FROM conversations WHERE type = 'commish_corner')")
    op.execute("DELETE FROM conversations WHERE type = 'commish_corner'")

    op.execute("ALTER TABLE conversations DROP CONSTRAINT conversations_type_check")
    op.execute("ALTER TABLE conversations ADD CONSTRAINT conversations_type_check CHECK (type IN ('league', 'direct'))")
    op.execute("ALTER TABLE conversations DROP COLUMN league_id")
