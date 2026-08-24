"""add accent_color to owner_preferences for customizable panel glow

Nullable — NULL means "use the app default" (Neon Green), same
"missing row/column == defaults" discipline as every other column in
this table (see app/queries/owner_preferences.py's get-or-default
read). Drives --user-accent app-wide (globals.css's .neon-panel),
which every content panel without its own established section color
(Standings, Rivalries, etc. — see frontend's sectionColors.ts) falls
back to.

Revision ID: 4254e9a81de3
Revises: d9cb24f5f6a8
Create Date: 2026-08-24 09:58:55.713280

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '4254e9a81de3'
down_revision: Union[str, Sequence[str], None] = 'd9cb24f5f6a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE owner_preferences ADD COLUMN accent_color TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE owner_preferences DROP COLUMN accent_color")
