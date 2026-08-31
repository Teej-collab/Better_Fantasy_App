"""add league_id to fantasy-league-scoped tables

Revision ID: 454d8edda612
Revises: d7deccb620bb
Create Date: 2026-08-31 08:38:22.307420

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '454d8edda612'
down_revision: Union[str, Sequence[str], None] = 'd7deccb620bb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Real fantasy-league concepts — every one of these currently assumes
# exactly one league (filtered only by `season`). Deliberately excludes
# two season-scoped tables that stay global: team_bye_weeks (a real
# NFL schedule fact — every league shares the same bye weeks) and
# league_state (a cache of the real NFL calendar's current week, not
# anything league-specific despite the table's name).
_TABLES = [
    "teams_by_season", "draft_config", "draft_picks", "matchups",
    "league_scoring_rules", "league_keeper_rules", "keeper_selections",
    "rosters", "current_rosters", "weekly_team_stats", "final_standings",
    "season_champions", "season_awards", "bench_crimes", "burn_history",
    "player_week_stats", "chug_debts", "chug_scores", "chug_standing",
    "chug_deadline_settlements", "chug_debt_accruals", "chug_weekly_status",
]


def upgrade() -> None:
    """Phase 3 of the multi-league migration (see TODO.md's PHASE 9
    entry) — column-only, backfilled, non-breaking. `owners` is
    deliberately NOT included here: it becomes a per-league team-
    membership record eventually, but that's a shape change (its
    meaning changes, not just an added column), planned for a later
    phase, not this one.

    DEFAULT 1 is a deliberate, temporary bridge, not a permanent
    default: today's domain code has no idea league_id exists, so
    every row it inserts between now and Phase 4 needs to land on
    League #1 automatically or writes would start failing a NOT NULL
    constraint. Phase 4 threads league_id through the domain layer for
    real and should drop this default once every write path sets it
    explicitly — leaving it in place after that would let a second
    league's writes silently default onto League #1's data.

    Existing UNIQUE constraints that assume one league (e.g.
    teams_by_season's (season, espn_team_id), player_week_stats' —
    (season, week, sleeper_player_id)) are deliberately left untouched
    here too — widening them to include league_id is a correctness
    change belonging to Phase 4, not a column-only migration.

    player_week_stats is a genuine open question this migration only
    flags, not solves: `raw_stats` is a real NFL fact (league-
    agnostic), but `fantasy_points` is computed from THIS league's
    scoring rules — two leagues with different rules can't share one
    row once that matters. It may need splitting into a global raw-
    stats table and a per-league computed-points table in Phase 4.
    """
    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} ADD COLUMN league_id INT NOT NULL DEFAULT 1 REFERENCES leagues(id)")


def downgrade() -> None:
    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} DROP COLUMN league_id")
