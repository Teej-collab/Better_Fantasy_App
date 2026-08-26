"""add players table

The first canonical NFL-player dimension table this app has ever had.
Sourced from Sleeper's free, keyless player API
(https://api.sleeper.app/v1/players/nfl — see app/providers/sleeper/),
not ESPN — see the project plan for why (a single shared ESPN session
can't write every owner's roster, so the app is moving off ESPN's
private API for draft/rosters/lineups entirely, keeping ESPN only for
the free public NFL scoreboard).

sleeper_player_id is the primary key — Sleeper's own id is free, stable,
and already unique, so there's no reason to mint a second surrogate key
that every other new table (draft_picks, current_rosters,
player_week_stats) would just have to carry alongside it.
espn_player_id is a nullable/unique crosswalk column (Sleeper's player
objects natively carry ESPN's id), kept for cross-referencing this
app's existing ESPN-era historical data (rosters, keeper_selections),
not for any live dependency on ESPN.

is_draftable is precomputed at ingestion time (see
app/providers/sleeper/ingest.py's filtering logic) so the draft's
player-pool query never has to re-derive "is this a real, active,
rosterable NFL player" from raw status/position fields on every
request.

Revision ID: eedfda2cf6fb
Revises: 18dbc89919aa
Create Date: 2026-08-26 14:50:01.501908

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'eedfda2cf6fb'
down_revision: Union[str, Sequence[str], None] = '18dbc89919aa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE players (
            sleeper_player_id TEXT PRIMARY KEY,
            espn_player_id INTEGER UNIQUE,
            full_name TEXT NOT NULL,
            first_name TEXT,
            last_name TEXT,
            position TEXT NOT NULL,
            fantasy_positions TEXT[] NOT NULL DEFAULT '{}',
            pro_team TEXT,
            status TEXT,
            injury_status TEXT,
            search_rank INTEGER,
            is_draftable BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX players_draftable_idx ON players (is_draftable, position, search_rank)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE players")
