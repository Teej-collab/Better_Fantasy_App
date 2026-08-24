"""add home_card_order to owner_preferences for dashboard customization

Nullable — NULL means "use the default order" (the app's own hardcoded
sequence: Your Week, Standings, Other Matchups, Rivalries, Awards,
Discover), same "missing == default" discipline as every other column
in this table. Stores a JSON-encoded array of card keys (e.g.
'["standings","yourWeek","matchups","rivalries","awards","discover"]')
rather than a real Postgres array/jsonb column — the set of valid keys
is small, fixed, and validated entirely in the API layer
(app/routers/settings.py), so there's no need for the database itself
to understand the shape.

Revision ID: ff83e77662c3
Revises: 4254e9a81de3
Create Date: 2026-08-24 11:35:58.543904

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'ff83e77662c3'
down_revision: Union[str, Sequence[str], None] = '4254e9a81de3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE owner_preferences ADD COLUMN home_card_order TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE owner_preferences DROP COLUMN home_card_order")
