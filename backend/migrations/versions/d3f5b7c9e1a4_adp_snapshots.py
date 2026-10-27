"""ADP snapshots from Fantasy Football Calculator

Fantasy Football Calculator's ADP API (free, credit with a link) only
ever returns its most recent window of drafts — there is no asking for
"ADP as of August 20". So app/domain/adp.py saves a copy every day of
the preseason, and a league's draft freezes the copy it starts with.

- adp_snapshots: one fetch of one format (ppr / half-ppr / standard /
  2qb / dynasty) at one league size, per day.
- adp_entries: that fetch's players, matched to players.sleeper_player_id
  where the name, position and team agree (NULL when nothing matched —
  kept so a bad match can be looked at, never guessed).
- draft_config.adp_snapshot_id: the copy this draft started with.
  Autopick, the draft room and draft grades all read this one.
- draft_projection_snapshots: every draftable player's season
  projection when the draft started, so grades judge the draft on what
  was known that day, not on a breakout two months later.

Revision ID: d3f5b7c9e1a4
Revises: c2e4a6b8d0f3
Create Date: 2026-10-27 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'd3f5b7c9e1a4'
down_revision: Union[str, Sequence[str], None] = 'c2e4a6b8d0f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE adp_snapshots (
            id             SERIAL PRIMARY KEY,
            season         INT NOT NULL,
            format         TEXT NOT NULL,
            teams          INT NOT NULL,
            fetched_on     DATE NOT NULL,
            total_drafts   INT,
            window_start   DATE,
            window_end     DATE,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (season, format, teams, fetched_on)
        )
    """)
    op.execute("""
        CREATE TABLE adp_entries (
            snapshot_id        INT NOT NULL REFERENCES adp_snapshots(id) ON DELETE CASCADE,
            ffc_player_id      INT NOT NULL,
            sleeper_player_id  TEXT,
            name               TEXT NOT NULL,
            position           TEXT NOT NULL,
            team               TEXT,
            adp                NUMERIC NOT NULL,
            stdev              NUMERIC,
            times_drafted      INT,
            PRIMARY KEY (snapshot_id, ffc_player_id)
        )
    """)
    op.execute("CREATE INDEX adp_entries_sleeper_idx ON adp_entries (snapshot_id, sleeper_player_id)")
    op.execute(
        "ALTER TABLE draft_config ADD COLUMN adp_snapshot_id INT REFERENCES adp_snapshots(id) ON DELETE SET NULL"
    )
    op.execute("""
        CREATE TABLE draft_projection_snapshots (
            season             INT NOT NULL,
            league_id          INT NOT NULL REFERENCES leagues(id),
            sleeper_player_id  TEXT NOT NULL,
            projected_points   NUMERIC NOT NULL,
            PRIMARY KEY (season, league_id, sleeper_player_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS draft_projection_snapshots")
    op.execute("ALTER TABLE draft_config DROP COLUMN IF EXISTS adp_snapshot_id")
    op.execute("DROP TABLE IF EXISTS adp_entries")
    op.execute("DROP TABLE IF EXISTS adp_snapshots")
