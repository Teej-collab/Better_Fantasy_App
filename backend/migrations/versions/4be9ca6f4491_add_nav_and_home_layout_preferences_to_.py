"""add nav and home layout preferences to owner_preferences

Three columns, same "NULL means use the app's hardcoded default" and
JSON-encoded-TEXT-not-a-real-array/jsonb-column discipline as the
existing home_card_order column (see ff83e77662c3) — the valid shapes
are small, fixed, and validated entirely in the API layer
(app/routers/settings.py), not the database:

- bottom_nav_order: JSON array of the 5 destination keys in the
  owner's chosen mobile bottom-nav order (e.g.
  '["team","league","home","matchups","chat"]').
- home_hidden_cards: JSON array of home-dashboard card keys the owner
  has deliberately hidden. Deliberately a separate column from
  home_card_order rather than "just omit it from the order" — the
  frontend's mergeCardOrder() needs to distinguish "owner explicitly
  hid this" (must stay hidden) from "this card type didn't exist yet
  when they last saved an order" (must still auto-appear for
  forward-compatibility with future card types).
- home_desktop_layout: JSON-encoded react-grid-layout layout array
  (`{i, x, y, w, h}[]`) for the desktop-only resizable dashboard grid.
  Independent from home_card_order (mobile) since the two breakpoints
  need fundamentally different shapes — an ordered list of keys vs.
  an array of position/size objects.

Revision ID: 4be9ca6f4491
Revises: 78281ee0bd15
Create Date: 2026-08-25 09:55:22.291030

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '4be9ca6f4491'
down_revision: Union[str, Sequence[str], None] = '78281ee0bd15'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE owner_preferences ADD COLUMN bottom_nav_order TEXT")
    op.execute("ALTER TABLE owner_preferences ADD COLUMN home_hidden_cards TEXT")
    op.execute("ALTER TABLE owner_preferences ADD COLUMN home_desktop_layout TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE owner_preferences DROP COLUMN home_desktop_layout")
    op.execute("ALTER TABLE owner_preferences DROP COLUMN home_hidden_cards")
    op.execute("ALTER TABLE owner_preferences DROP COLUMN bottom_nav_order")
