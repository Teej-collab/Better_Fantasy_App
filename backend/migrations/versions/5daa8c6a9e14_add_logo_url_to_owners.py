"""add logo_url to owners for a self-serve team logo

Lets an owner upload and crop an image into a round team logo
(frontend's new LogoUploadCropper.tsx + PUT /settings/logo). Owner-
scoped, not teams_by_season-scoped, matching the existing precedent of
display_name/chat_color — a self-serve identity field that persists
across seasons rather than being re-entered every year.

Confirmed safe from app/providers/espn/adapter.py's sync_teams upsert
(INSERT INTO owners ... ON CONFLICT (espn_member_id) DO UPDATE): that
statement only ever assigns display_name, so this column is never at
risk of being silently reset by a sync — no display_name_is_custom-
style protection flag needed here.

Revision ID: 5daa8c6a9e14
Revises: c4613ad6cdee
Create Date: 2026-09-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '5daa8c6a9e14'
down_revision: Union[str, Sequence[str], None] = 'c4613ad6cdee'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE owners ADD COLUMN logo_url TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE owners DROP COLUMN logo_url")
