"""Private player-card photos, and ESPN account aliases for merged owners

owner_card_photos: each owner's trading-card photo, per league, kept in
the private bucket (app/providers/card_photo_storage.py) and only handed
out as short-lived signed links to members of that league. Replaces the
photos that were bundled in the app and public on the website.

owner_espn_aliases: when one person has two ESPN accounts (Tyler
Dailey's 2025 team came in under a second one, as "Ligmuh Bauhs"), the
owners are merged (app/domain/owner_merge.py) and the extra ESPN member
id is recorded here, so the ESPN sync maps it to the real owner instead
of re-creating the duplicate on every sync.

Revision ID: a1d3f5b7c9e2
Revises: f9b1d3e5a7c0
Create Date: 2026-10-07 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a1d3f5b7c9e2'
down_revision: Union[str, Sequence[str], None] = 'f9b1d3e5a7c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE owner_card_photos (
            owner_id    INT NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
            league_id   INT NOT NULL,
            object_key  TEXT NOT NULL,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (owner_id, league_id)
        )
    """)
    op.execute("""
        CREATE TABLE owner_espn_aliases (
            espn_member_id  TEXT PRIMARY KEY,
            owner_id        INT NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE owner_espn_aliases")
    op.execute("DROP TABLE owner_card_photos")
