"""Mirror mode and the switch to The Weekend

A league connected to ESPN or Sleeper runs in mirror mode: its rosters
follow the source and roster moves here are locked. The commissioner can
then switch it over for good.

- league_espn_connections.import_notes / league_sleeper_connections.
  import_notes: what bringing the league's settings over couldn't match
  exactly (a scoring rule this app doesn't score, a points-allowed band
  that's split differently), shown before switching.
- league_switches: a league's switch to The Weekend. Asked for by the
  commissioner, it takes effect at `effective_week` (never mid-week);
  completed_at is set once it has happened.
- faab_carryover: FAAB a team already spent on ESPN/Sleeper before the
  switch, so its balance here starts where it left off.

Purely additive: two columns, two tables.

Revision ID: a7c3e9f1d2b4
Revises: f2b8d4a6c1e9
Create Date: 2026-10-24 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'a7c3e9f1d2b4'
down_revision: Union[str, Sequence[str], None] = 'f2b8d4a6c1e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE league_espn_connections ADD COLUMN import_notes JSONB")
    op.execute("ALTER TABLE league_sleeper_connections ADD COLUMN import_notes JSONB")
    op.execute(
        """
        CREATE TABLE league_switches (
            league_id             INT NOT NULL PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
            platform              TEXT NOT NULL CHECK (platform IN ('espn', 'sleeper')),
            requested_by_user_id  INT REFERENCES users(id) ON DELETE SET NULL,
            requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            effective_week        INT NOT NULL,
            completed_at          TIMESTAMPTZ,
            notes                 JSONB
        )
        """
    )
    op.execute(
        """
        CREATE TABLE faab_carryover (
            league_id  INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
            season     INT NOT NULL,
            team_id    INT NOT NULL REFERENCES teams_by_season(id) ON DELETE CASCADE,
            amount     INT NOT NULL,
            PRIMARY KEY (league_id, season, team_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS faab_carryover")
    op.execute("DROP TABLE IF EXISTS league_switches")
    op.execute("ALTER TABLE league_sleeper_connections DROP COLUMN IF EXISTS import_notes")
    op.execute("ALTER TABLE league_espn_connections DROP COLUMN IF EXISTS import_notes")
