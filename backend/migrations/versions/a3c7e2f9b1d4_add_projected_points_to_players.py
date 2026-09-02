"""add projected_points to players for the draft pool's inline stats

Nullable — "no data" is the real, expected state for a lot of rows here:
this is filled by a bulk ESPN sync (app/domain/player_projections.py)
matched onto a player by the existing espn_player_id crosswalk (only
populated for a majority, not all, of this league's draftable pool —
see app/providers/sleeper/ingest.py's own sync-coverage logging) or by
an exact full_name match as a second pass. A player neither resolves
against just shows a blank in the draft pool rather than blocking
anything — this is a display enrichment, not load-bearing data.

Bye week and ADP, the other two fields the draft pool now shows inline,
deliberately get no new column here: bye week is already fully covered
by the existing team_bye_weeks table (a per-team, not per-player, join
on players.pro_team — no ESPN dependency at all), and ADP reuses the
existing players.search_rank (Sleeper's own overall-rank proxy,
already the closest thing to real ADP this app has — see
app/domain/draft_autopick.py's own docstring). Only projected season
points was a genuine gap with nowhere else to source it from.

Revision ID: a3c7e2f9b1d4
Revises: f1a2b3c4d5e6
Create Date: 2026-09-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a3c7e2f9b1d4'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE players ADD COLUMN projected_points NUMERIC")


def downgrade() -> None:
    op.execute("ALTER TABLE players DROP COLUMN projected_points")
