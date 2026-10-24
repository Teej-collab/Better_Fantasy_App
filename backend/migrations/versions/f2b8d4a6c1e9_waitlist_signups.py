"""The 2027 waitlist, ESPN leagues connected by link alone, Sleeper leagues

- waitlist_signups — the 2027 waitlist: commissioners (and players) who want The Weekend
for their league next season, from the public /waitlist page and the
"Get this for your league" links on shared cards.

  One row per email (a second signup updates it). `ref` is where they
  came from (e.g. share-recap), for seeing which shares bring people in.
- league_espn_connections.espn_s2_encrypted / espn_swid_encrypted become
  optional: a public ESPN league connects with just its link, no
  cookies (NULL = public).

- league_sleeper_connections: a league brought in from Sleeper (its
  league id; Sleeper's API needs no sign-in), synced like an ESPN one.

Additive: two new tables, two columns loosened to allow NULL.

Revision ID: f2b8d4a6c1e9
Revises: e6a1c9d3b7f2
Create Date: 2026-10-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'f2b8d4a6c1e9'
down_revision: Union[str, Sequence[str], None] = 'e6a1c9d3b7f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE waitlist_signups (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL,
            name TEXT,
            role TEXT NOT NULL DEFAULT 'commissioner' CHECK (role IN ('commissioner', 'player')),
            league_size INTEGER CHECK (league_size BETWEEN 2 AND 32),
            platform TEXT CHECK (platform IN ('espn', 'sleeper', 'yahoo', 'nfl', 'other', 'none')),
            note TEXT,
            ref TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE UNIQUE INDEX uq_waitlist_signups_email ON waitlist_signups (lower(email))")
    op.execute("ALTER TABLE league_espn_connections ALTER COLUMN espn_s2_encrypted DROP NOT NULL")
    op.execute("ALTER TABLE league_espn_connections ALTER COLUMN espn_swid_encrypted DROP NOT NULL")
    op.execute(
        """
        CREATE TABLE league_sleeper_connections (
            league_id             INT NOT NULL PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
            sleeper_league_id     TEXT NOT NULL,
            league_name           TEXT,
            connected_by_user_id  INT REFERENCES users(id) ON DELETE SET NULL,
            created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_synced_at        TIMESTAMPTZ,
            last_sync_error       TEXT
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS league_sleeper_connections")
    # Public (cookie-less) connections can't satisfy NOT NULL again.
    op.execute("DELETE FROM league_espn_connections WHERE espn_s2_encrypted IS NULL OR espn_swid_encrypted IS NULL")
    op.execute("ALTER TABLE league_espn_connections ALTER COLUMN espn_s2_encrypted SET NOT NULL")
    op.execute("ALTER TABLE league_espn_connections ALTER COLUMN espn_swid_encrypted SET NOT NULL")
    op.execute("DROP TABLE waitlist_signups")
