"""add team name custom override

Same pattern as owners.display_name_is_custom (migration
893534025217): teams_by_season.team_name is kept current by every ESPN
sync (app/providers/espn/adapter.py's sync_teams upserts it from the
real ESPN team name on every full/live sync, which runs automatically
and frequently during live games) — without a flag, a self-serve team
name set through app/routers/settings.py would silently get overwritten
back to the ESPN name on the very next sync. team_name_is_custom makes
the sync's upsert skip overwriting team_name for a season/team row whose
flag is set, the same way display_name_is_custom already protects
owners.display_name.

Revision ID: 78281ee0bd15
Revises: 6a96fdae6d6c
Create Date: 2026-08-24 20:23:12.621069

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '78281ee0bd15'
down_revision: Union[str, Sequence[str], None] = '6a96fdae6d6c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE teams_by_season ADD COLUMN team_name_is_custom BOOLEAN NOT NULL DEFAULT FALSE")


def downgrade() -> None:
    op.execute("ALTER TABLE teams_by_season DROP COLUMN team_name_is_custom")
