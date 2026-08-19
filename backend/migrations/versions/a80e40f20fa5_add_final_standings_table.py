"""add final standings table

Stores ESPN's own final-season ranking (Team.final_standing, from the
`rankCalculatedFinal` field — accounts for the full playoff bracket, not
approximated from regular-season record). Confirmed against real league
data before building this: for the 2024 season the champion
(Amishtown Rumspringers) was seeded 4th going into the playoffs but
correctly shows final_standing=1.

`final_standing` is 0 for a season still in progress — the sync only
writes a row once a team has a real final rank, so a season with no
rows here yet is expected, not a sync failure.

Revision ID: a80e40f20fa5
Revises: 3d2a7cf84eb9
Create Date: 2026-08-19 09:11:43.705474

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a80e40f20fa5'
down_revision: Union[str, Sequence[str], None] = '3d2a7cf84eb9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE final_standings (
            id          SERIAL PRIMARY KEY,
            season      INT NOT NULL,
            team_id     INT NOT NULL REFERENCES teams_by_season(id),
            final_rank  INT NOT NULL,
            UNIQUE (season, team_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE final_standings")
