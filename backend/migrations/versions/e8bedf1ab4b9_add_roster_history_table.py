"""add roster_history table for real per-week roster snapshots

current_rosters (6991e4edf816) is this app's own live roster of record
but has no `week` column and no history at all — every lineup swap,
waiver add/drop, or trade overwrites it in place. There has never been
any way to answer "what was team X's real roster in week N" for any
week, past or present. roster_history fixes that: a per-week mirror of
current_rosters, kept in sync with it (via app/providers/sync.py's
_update_league_state, on every full/live sync tick) for whichever week
is the season's actual current week, and then simply left untouched —
frozen — the moment the season rolls over to the next week. That's
what "assume the same roster unless a player makes a change" means in
practice: nothing needs to explicitly carry a roster forward, because
a week's row set is never touched again once it stops being current.

No `league_id` column — matches current_rosters exactly (that table
has none either; every real caller here scopes by season + team_id
only, the same convention app/queries/league.py's get_current_roster
already uses).

points_projected is captured at snapshot time from
players.projected_avg_points (the same season-average stand-in used
everywhere else in the app as "this week's projection" — see
761a416f35f7's own docstring) so a past week's PROJ number stays
frozen even if that season-average is later resynced to a different
value.

is_boom/is_bust default to FALSE and are written after the fact by
app/domain/boom_bust.py once it's repointed at this table for the
current in-app-draft season (2026-09 follow-up) — this is what
finally lets a past week's roster show real boom/bust classification,
instead of the hardcoded FALSE app/queries/league.py's get_current_roster
has always returned.

Revision ID: e8bedf1ab4b9
Revises: 761a416f35f7
Create Date: 2026-09-07 20:05:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e8bedf1ab4b9'
down_revision: Union[str, Sequence[str], None] = '761a416f35f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE roster_history (
            id SERIAL PRIMARY KEY,
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            team_id INTEGER NOT NULL REFERENCES teams_by_season(id),
            sleeper_player_id TEXT NOT NULL REFERENCES players(sleeper_player_id),
            lineup_slot TEXT NOT NULL,
            points_projected NUMERIC,
            is_boom BOOLEAN NOT NULL DEFAULT FALSE,
            is_bust BOOLEAN NOT NULL DEFAULT FALSE,
            snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (season, week, team_id, sleeper_player_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX roster_history_fallback_idx ON roster_history (season, team_id, week DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE roster_history")
