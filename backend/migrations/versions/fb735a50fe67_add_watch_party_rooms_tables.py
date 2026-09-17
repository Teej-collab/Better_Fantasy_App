"""add watch_party_rooms and watch_party_room_members tables

Phase 1 of the Watch Party feature (group video/voice + live fantasy
overlay, reached from Chat) — plan agreed 2026-09-16. Two kinds of
room: exactly one always-open "League Lounge" per league (membership
implicit — every active league member is eligible, same check chat's
own list_eligible_members already uses) and any number of invite-only
"private" rooms, created ad hoc by any owner to bring in a specific
subset of the league (like starting a private Zoom).

watch_party_room_members is only ever consulted for a 'private' room —
an 'open' room's eligibility is computed at request time from league
membership, not from a row here, so this table never gets a row for
the open room at all. The partial unique index enforces "at most one
open room per league" at the database level rather than relying on
application code to never insert a second one.

No video/session state lives here — LiveKit itself is the source of
truth for who's actually connected to a room's media; this table is
only the room/invite model this app owns.

Revision ID: fb735a50fe67
Revises: 465f0b1ffe3f
Create Date: 2026-09-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'fb735a50fe67'
down_revision: Union[str, Sequence[str], None] = '465f0b1ffe3f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE watch_party_rooms (
            id SERIAL PRIMARY KEY,
            league_id INTEGER NOT NULL REFERENCES leagues(id),
            name TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('open', 'private')),
            created_by_owner_id INTEGER NOT NULL REFERENCES owners(owner_id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            closed_at TIMESTAMPTZ
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX watch_party_rooms_one_open_per_league
        ON watch_party_rooms (league_id)
        WHERE kind = 'open'
        """
    )
    op.execute(
        """
        CREATE TABLE watch_party_room_members (
            room_id INTEGER NOT NULL REFERENCES watch_party_rooms(id),
            owner_id INTEGER NOT NULL REFERENCES owners(owner_id),
            invited_by_owner_id INTEGER NOT NULL REFERENCES owners(owner_id),
            joined_at TIMESTAMPTZ,
            left_at TIMESTAMPTZ,
            PRIMARY KEY (room_id, owner_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE watch_party_room_members")
    op.execute("DROP TABLE watch_party_rooms")
