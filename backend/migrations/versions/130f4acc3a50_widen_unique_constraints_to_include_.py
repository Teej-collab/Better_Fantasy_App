"""widen unique constraints to include league_id for real multi-league safety

Revision ID: 130f4acc3a50
Revises: 1595f790df89
Create Date: 2026-08-31 10:04:16.064644

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '130f4acc3a50'
down_revision: Union[str, Sequence[str], None] = '1595f790df89'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Phase 3 (454d8edda612) deliberately left every existing UNIQUE/
    PRIMARY KEY constraint untouched when it added league_id to these
    tables, calling widening them "a correctness change... belonging
    to Phase 4, not this column-only one." Phase 4 threaded league_id
    through every query, but never came back to actually widen the
    constraints — this is that follow-through, done now because it
    turned out to be a hard blocker for the very first real two-league
    scenario (seeding a second league's own scoring rules collided
    with League #1's row for the same season/stat_category).

    Only tables where the OTHER unique columns are genuinely shared
    across leagues get widened — `owner_id` (a real person, not
    league-scoped), `sleeper_player_id` (a real NFL player, not
    league-scoped), and fixed vocabulary like `stat_category`/
    `award_type`, or literally just `season` alone. Left alone:
    `matchups`, `weekly_team_stats`, and `final_standings` — those are
    already unique on `home_team_id`/`away_team_id`/`team_id`, which
    are `teams_by_season.id` values, already implicitly league-specific
    (a team can only ever belong to one league), so two leagues can't
    actually collide there regardless.

    Every existing row already has league_id = 1 (Phase 3's backfill),
    so widening these constraints changes nothing about what's already
    unique among them — it only permits combinations that couldn't
    exist before (the same season/stat_category/etc. under a
    *different* league_id).
    """
    op.execute("ALTER TABLE draft_config DROP CONSTRAINT draft_config_pkey")
    op.execute("ALTER TABLE draft_config ADD PRIMARY KEY (season, league_id)")

    op.execute("ALTER TABLE league_keeper_rules DROP CONSTRAINT league_keeper_rules_pkey")
    op.execute("ALTER TABLE league_keeper_rules ADD PRIMARY KEY (season, league_id)")

    op.execute("ALTER TABLE season_champions DROP CONSTRAINT season_champions_season_key")
    op.execute("ALTER TABLE season_champions ADD CONSTRAINT season_champions_season_league_id_key UNIQUE (season, league_id)")

    op.execute("ALTER TABLE teams_by_season DROP CONSTRAINT teams_by_season_season_espn_team_id_key")
    op.execute(
        "ALTER TABLE teams_by_season ADD CONSTRAINT teams_by_season_season_espn_team_id_league_id_key "
        "UNIQUE (season, espn_team_id, league_id)"
    )

    op.execute("ALTER TABLE draft_picks DROP CONSTRAINT draft_picks_season_pick_number_key")
    op.execute(
        "ALTER TABLE draft_picks ADD CONSTRAINT draft_picks_season_pick_number_league_id_key "
        "UNIQUE (season, pick_number, league_id)"
    )

    op.execute("ALTER TABLE league_scoring_rules DROP CONSTRAINT league_scoring_rules_season_stat_category_key")
    op.execute(
        "ALTER TABLE league_scoring_rules ADD CONSTRAINT league_scoring_rules_season_stat_category_league_id_key "
        "UNIQUE (season, stat_category, league_id)"
    )

    op.execute("ALTER TABLE season_awards DROP CONSTRAINT season_awards_season_award_type_key")
    op.execute(
        "ALTER TABLE season_awards ADD CONSTRAINT season_awards_season_award_type_league_id_key "
        "UNIQUE (season, award_type, league_id)"
    )

    op.execute(
        "ALTER TABLE keeper_selections DROP CONSTRAINT keeper_selections_season_owner_id_espn_player_id_key"
    )
    op.execute(
        "ALTER TABLE keeper_selections ADD CONSTRAINT keeper_selections_season_owner_id_espn_player_id_league_id_key "
        "UNIQUE (season, owner_id, espn_player_id, league_id)"
    )

    # current_rosters: two independent constraints — both widened.
    op.execute("ALTER TABLE current_rosters DROP CONSTRAINT current_rosters_season_sleeper_player_id_key")
    op.execute(
        "ALTER TABLE current_rosters ADD CONSTRAINT current_rosters_season_sleeper_player_id_league_id_key "
        "UNIQUE (season, sleeper_player_id, league_id)"
    )
    op.execute(
        "ALTER TABLE current_rosters DROP CONSTRAINT current_rosters_season_team_id_sleeper_player_id_key"
    )
    op.execute(
        "ALTER TABLE current_rosters ADD CONSTRAINT current_rosters_season_team_id_sleeper_player_id_league_id_key "
        "UNIQUE (season, team_id, sleeper_player_id, league_id)"
    )

    # player_week_stats — the one flagged most explicitly (see
    # migration 454d8edda612's docstring): raw_stats and fantasy_points
    # share one row, so this widening is what actually lets two
    # leagues each get their own fantasy_points for the same real
    # player/week, computed under their own scoring rules — without a
    # separate table. The trade-off, accepted deliberately rather than
    # solved: a league's weekly compute still does its own real
    # network fetch of that week's NFL stats even if another league
    # already fetched the same games — a real but small inefficiency,
    # not a correctness problem, not worth a shared-cache layer yet at
    # this app's actual scale.
    op.execute("ALTER TABLE player_week_stats DROP CONSTRAINT player_week_stats_season_week_sleeper_player_id_key")
    op.execute(
        "ALTER TABLE player_week_stats ADD CONSTRAINT player_week_stats_season_week_sleeper_player_id_league_id_key "
        "UNIQUE (season, week, sleeper_player_id, league_id)"
    )

    op.execute("ALTER TABLE chug_debts DROP CONSTRAINT chug_debts_season_week_owner_id_key")
    op.execute(
        "ALTER TABLE chug_debts ADD CONSTRAINT chug_debts_season_week_owner_id_league_id_key "
        "UNIQUE (season, week, owner_id, league_id)"
    )

    op.execute("ALTER TABLE chug_standing DROP CONSTRAINT chug_standing_season_owner_id_key")
    op.execute(
        "ALTER TABLE chug_standing ADD CONSTRAINT chug_standing_season_owner_id_league_id_key "
        "UNIQUE (season, owner_id, league_id)"
    )

    op.execute(
        "ALTER TABLE chug_deadline_settlements DROP CONSTRAINT chug_deadline_settlements_season_week_owner_id_key"
    )
    op.execute(
        "ALTER TABLE chug_deadline_settlements ADD CONSTRAINT chug_deadline_settlements_season_week_owner_id_league_id_key "
        "UNIQUE (season, week, owner_id, league_id)"
    )

    op.execute("ALTER TABLE chug_debt_accruals DROP CONSTRAINT chug_debt_accruals_season_week_owner_id_key")
    op.execute(
        "ALTER TABLE chug_debt_accruals ADD CONSTRAINT chug_debt_accruals_season_week_owner_id_league_id_key "
        "UNIQUE (season, week, owner_id, league_id)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE chug_debt_accruals DROP CONSTRAINT chug_debt_accruals_season_week_owner_id_league_id_key")
    op.execute("ALTER TABLE chug_debt_accruals ADD CONSTRAINT chug_debt_accruals_season_week_owner_id_key UNIQUE (season, week, owner_id)")

    op.execute("ALTER TABLE chug_deadline_settlements DROP CONSTRAINT chug_deadline_settlements_season_week_owner_id_league_id_key")
    op.execute("ALTER TABLE chug_deadline_settlements ADD CONSTRAINT chug_deadline_settlements_season_week_owner_id_key UNIQUE (season, week, owner_id)")

    op.execute("ALTER TABLE chug_standing DROP CONSTRAINT chug_standing_season_owner_id_league_id_key")
    op.execute("ALTER TABLE chug_standing ADD CONSTRAINT chug_standing_season_owner_id_key UNIQUE (season, owner_id)")

    op.execute("ALTER TABLE chug_debts DROP CONSTRAINT chug_debts_season_week_owner_id_league_id_key")
    op.execute("ALTER TABLE chug_debts ADD CONSTRAINT chug_debts_season_week_owner_id_key UNIQUE (season, week, owner_id)")

    op.execute("ALTER TABLE player_week_stats DROP CONSTRAINT player_week_stats_season_week_sleeper_player_id_league_id_key")
    op.execute("ALTER TABLE player_week_stats ADD CONSTRAINT player_week_stats_season_week_sleeper_player_id_key UNIQUE (season, week, sleeper_player_id)")

    op.execute("ALTER TABLE current_rosters DROP CONSTRAINT current_rosters_season_team_id_sleeper_player_id_league_id_key")
    op.execute("ALTER TABLE current_rosters ADD CONSTRAINT current_rosters_season_team_id_sleeper_player_id_key UNIQUE (season, team_id, sleeper_player_id)")
    op.execute("ALTER TABLE current_rosters DROP CONSTRAINT current_rosters_season_sleeper_player_id_league_id_key")
    op.execute("ALTER TABLE current_rosters ADD CONSTRAINT current_rosters_season_sleeper_player_id_key UNIQUE (season, sleeper_player_id)")

    op.execute("ALTER TABLE keeper_selections DROP CONSTRAINT keeper_selections_season_owner_id_espn_player_id_league_id_key")
    op.execute("ALTER TABLE keeper_selections ADD CONSTRAINT keeper_selections_season_owner_id_espn_player_id_key UNIQUE (season, owner_id, espn_player_id)")

    op.execute("ALTER TABLE season_awards DROP CONSTRAINT season_awards_season_award_type_league_id_key")
    op.execute("ALTER TABLE season_awards ADD CONSTRAINT season_awards_season_award_type_key UNIQUE (season, award_type)")

    op.execute("ALTER TABLE league_scoring_rules DROP CONSTRAINT league_scoring_rules_season_stat_category_league_id_key")
    op.execute("ALTER TABLE league_scoring_rules ADD CONSTRAINT league_scoring_rules_season_stat_category_key UNIQUE (season, stat_category)")

    op.execute("ALTER TABLE draft_picks DROP CONSTRAINT draft_picks_season_pick_number_league_id_key")
    op.execute("ALTER TABLE draft_picks ADD CONSTRAINT draft_picks_season_pick_number_key UNIQUE (season, pick_number)")

    op.execute("ALTER TABLE teams_by_season DROP CONSTRAINT teams_by_season_season_espn_team_id_league_id_key")
    op.execute("ALTER TABLE teams_by_season ADD CONSTRAINT teams_by_season_season_espn_team_id_key UNIQUE (season, espn_team_id)")

    op.execute("ALTER TABLE season_champions DROP CONSTRAINT season_champions_season_league_id_key")
    op.execute("ALTER TABLE season_champions ADD CONSTRAINT season_champions_season_key UNIQUE (season)")

    op.execute("ALTER TABLE league_keeper_rules DROP CONSTRAINT league_keeper_rules_pkey")
    op.execute("ALTER TABLE league_keeper_rules ADD PRIMARY KEY (season)")

    op.execute("ALTER TABLE draft_config DROP CONSTRAINT draft_config_pkey")
    op.execute("ALTER TABLE draft_config ADD PRIMARY KEY (season)")
