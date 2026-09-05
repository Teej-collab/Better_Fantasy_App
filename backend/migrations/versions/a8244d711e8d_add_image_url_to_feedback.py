"""add image_url to feedback

Revision ID: a8244d711e8d
Revises: aa47e92ad5fe
Create Date: 2026-09-04 17:26:54.830227

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a8244d711e8d'
down_revision: Union[str, Sequence[str], None] = 'aa47e92ad5fe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE feedback ADD COLUMN image_url TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE feedback DROP COLUMN image_url")
