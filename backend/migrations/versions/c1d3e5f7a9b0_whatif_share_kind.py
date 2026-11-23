"""Share links: What-If worlds and survivor pools

A What-If scenario shares as a card link like everything else
(2026-11-23), so it opens the app instead of the web's standings page;
a survivor pool's invite does too, instead of a bare code in a text.

Revision ID: c1d3e5f7a9b0
Revises: e6a8c0b2d4f7
Create Date: 2026-11-23
"""
from alembic import op

revision = "c1d3e5f7a9b0"
down_revision = "e6a8c0b2d4f7"
branch_labels = None
depends_on = None

_BEFORE = "'matchup', 'recap', 'standings', 'power', 'awards', 'champion', 'season_awards', 'chug', 'bet', 'trade', 'wheel', 'invite', 'player'"
_ALL = _BEFORE + ", 'whatif', 'survivor'"


def upgrade() -> None:
    op.execute("ALTER TABLE share_links DROP CONSTRAINT share_links_kind_check")
    op.execute(f"ALTER TABLE share_links ADD CONSTRAINT share_links_kind_check CHECK (kind IN ({_ALL}))")


def downgrade() -> None:
    op.execute(f"DELETE FROM share_links WHERE kind NOT IN ({_BEFORE})")
    op.execute("ALTER TABLE share_links DROP CONSTRAINT share_links_kind_check")
    op.execute(f"ALTER TABLE share_links ADD CONSTRAINT share_links_kind_check CHECK (kind IN ({_BEFORE}))")
