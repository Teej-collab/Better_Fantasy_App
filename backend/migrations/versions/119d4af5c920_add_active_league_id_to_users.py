"""add active_league_id to users

Revision ID: 119d4af5c920
Revises: 130f4acc3a50
Create Date: 2026-08-31 12:14:16.840034

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '119d4af5c920'
down_revision: Union[str, Sequence[str], None] = '130f4acc3a50'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """The real "which league am I looking at" source of truth (see
    TODO.md's PHASE 9 entry) — deliberately NOT resolved from anything
    client-supplied (a URL, query param, or request body) so a visitor
    can never see another league's data by editing a request; only a
    verified-membership "select" action (POST /leagues/{id}/select)
    changes this. Nullable — a brand-new signup has no active league
    until they create or join one.

    This retires DEFAULT_LEAGUE_ID (app/config.py) as the *real*
    per-request answer — that constant now only matters as the
    signed-out/public-preview fallback."""
    op.execute("ALTER TABLE users ADD COLUMN active_league_id INT REFERENCES leagues(id)")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN active_league_id")
