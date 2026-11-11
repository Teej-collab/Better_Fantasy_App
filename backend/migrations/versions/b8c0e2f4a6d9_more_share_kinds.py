"""Share links: the second pass of cards

Champion, season awards, chug, bet, trade, punishment wheel, league
invite and the Gamecast player card (2026-11-11) join the five kinds
share_links started with (a7b9d1f3e5c8).

Revision ID: b8c0e2f4a6d9
Revises: a7b9d1f3e5c8
Create Date: 2026-11-11
"""
from alembic import op

revision = "b8c0e2f4a6d9"
down_revision = "a7b9d1f3e5c8"
branch_labels = None
depends_on = None

_FIRST = "'matchup', 'recap', 'standings', 'power', 'awards'"
_ALL = _FIRST + ", 'champion', 'season_awards', 'chug', 'bet', 'trade', 'wheel', 'invite', 'player'"


def upgrade() -> None:
    op.execute("ALTER TABLE share_links DROP CONSTRAINT share_links_kind_check")
    op.execute(f"ALTER TABLE share_links ADD CONSTRAINT share_links_kind_check CHECK (kind IN ({_ALL}))")


def downgrade() -> None:
    op.execute(f"DELETE FROM share_links WHERE kind NOT IN ({_FIRST})")
    op.execute("ALTER TABLE share_links DROP CONSTRAINT share_links_kind_check")
    op.execute(f"ALTER TABLE share_links ADD CONSTRAINT share_links_kind_check CHECK (kind IN ({_FIRST}))")
