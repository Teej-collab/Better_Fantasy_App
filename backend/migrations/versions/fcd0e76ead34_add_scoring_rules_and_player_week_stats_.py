"""add scoring rules and player week stats tables

Phase D of the ESPN-independence pivot (see TODO.md, SCORING_ENGINE_
SOURCE.md) — this app computes its own fantasy points now, from raw
stats pulled from ESPN's public boxscore endpoint (verified to have
full per-player stat lines), instead of copying ESPN's own
already-computed points_scored verbatim the way the legacy `rosters`
table always did.

league_scoring_rules is season-scoped (a league could theoretically
change its scoring year to year) — one row per stat_category with the
point value per unit, e.g. ('pass_yd', 0.04) for 1 pt per 25 passing
yards. Seeded from the commissioner's real ESPN league settings
(screenshots captured this session — see TODO.md's Phase D entry) via
migration data, not left for someone to configure blind.

player_week_stats stores one row per player per week: the raw stat
line (JSONB, keyed by the same stat_category names as
league_scoring_rules) and the computed fantasy_points total — computed
once and stored, not recomputed live on every read, same "generate
once, store" discipline as the (still-unbuilt) matchup_recaps plan
called for.

KNOWN GAP, seeded anyway (see SCORING_ENGINE_SOURCE.md): four scoring
values were never fully captured/confirmed from the owner's ESPN
settings screenshots (screen captures cut off) — D/ST points-allowed
18-27 bucket, D/ST yards-allowed 300-349 bucket, FG-missed-50+, and
whether "Total FG Missed" stacks with the distance-specific miss
penalty. Seeded here with a reasonable interpolation (marked ASSUMED in
the values below), to be corrected once validated against this
league's own historical 2023-2025 ESPN-computed scores or the owner's
direct confirmation — not blocking Phase D on this.

ALSO A KNOWN GAP: rare-event categories this league scores (2pt
conversions, blocked kicks, safeties) aren't derivable from ESPN's
public boxscore stat tables at all (only from play-by-play, not yet
parsed) — their point values are seeded here for completeness, but the
scoring engine has no way to produce a nonzero count for them yet, so
they'll always compute as 0 contribution until a follow-up captures
scoringPlays parsing.

Revision ID: fcd0e76ead34
Revises: 6991e4edf816
Create Date: 2026-08-26 16:39:20.977328

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fcd0e76ead34'
down_revision: Union[str, Sequence[str], None] = '6991e4edf816'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (stat_category, points_per_unit) — VERIFIED values captured directly
# from the owner's real ESPN league settings screenshots this session,
# except the four marked ASSUMED (see docstring above).
_SCORING_RULES = [
    # Passing
    ("pass_yd", 0.04), ("pass_td", 4), ("pass_int", -2), ("two_pt_pass", 2),
    # Rushing
    ("rush_yd", 0.1), ("rush_td", 6), ("two_pt_rush", 2),
    # Receiving (full PPR)
    ("rec_yd", 0.1), ("rec", 1), ("rec_td", 6), ("two_pt_rec", 2),
    # Kicking
    ("xp_made", 1),
    ("fg_miss_total", -1),  # general catch-all, stacks with distance bucket below — ASSUMED
    ("fg_0_39", 3), ("fg_40_49", 4), ("fg_50_59", 5), ("fg_60_plus", 6),
    ("fg_miss_0_39", -5), ("fg_miss_40_49", -3),
    ("fg_miss_50_plus", -1),  # ASSUMED — not captured, interpolated from the 0-39/40-49 trend
    # Team defense/special teams
    ("def_sack", 1), ("def_int", 2), ("def_fum_rec", 2), ("def_safety", 2),
    ("def_return_td", 6),  # any return TD (INT/fumble/kickoff/punt/blocked-kick)
    ("def_block", 2),  # blocked punt/PAT/FG
    ("pts_allow_0", 5), ("pts_allow_1_6", 4), ("pts_allow_7_13", 3), ("pts_allow_14_17", 1),
    ("pts_allow_18_27", 0),  # ASSUMED — not captured, interpolated between 1 and -1
    ("pts_allow_28_34", -1), ("pts_allow_35_45", -3), ("pts_allow_46_plus", -5),
    ("yds_allow_lt100", 5), ("yds_allow_100_199", 3), ("yds_allow_200_299", 2),
    ("yds_allow_300_349", 1),  # ASSUMED — not captured, interpolated between 2 and -1
    ("yds_allow_350_399", -1), ("yds_allow_400_449", -3), ("yds_allow_450_499", -5),
    ("yds_allow_500_549", -6), ("yds_allow_550_plus", -7),
    # Misc (any individual player — return TDs/fumbles lost, same values as the D/ST section)
    ("ret_td", 6), ("fum_lost", -2), ("two_pt_return", 2), ("safety_1pt", 1),
]


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE league_scoring_rules (
            id SERIAL PRIMARY KEY,
            season INTEGER NOT NULL,
            stat_category TEXT NOT NULL,
            points_per_unit NUMERIC NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (season, stat_category)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE player_week_stats (
            id SERIAL PRIMARY KEY,
            season INTEGER NOT NULL,
            week INTEGER NOT NULL,
            sleeper_player_id TEXT NOT NULL REFERENCES players(sleeper_player_id),
            raw_stats JSONB NOT NULL DEFAULT '{}',
            fantasy_points NUMERIC NOT NULL DEFAULT 0,
            computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (season, week, sleeper_player_id)
        )
        """
    )

    conn = op.get_bind()
    for season in (2026,):
        for stat_category, points_per_unit in _SCORING_RULES:
            conn.execute(
                sa.text(
                    "INSERT INTO league_scoring_rules (season, stat_category, points_per_unit) "
                    "VALUES (:season, :stat_category, :points_per_unit)"
                ),
                {"season": season, "stat_category": stat_category, "points_per_unit": points_per_unit},
            )


def downgrade() -> None:
    op.execute("DROP TABLE player_week_stats")
    op.execute("DROP TABLE league_scoring_rules")
