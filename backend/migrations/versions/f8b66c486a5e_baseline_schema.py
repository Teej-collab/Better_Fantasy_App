"""baseline schema

Originally ported from Fantasy_Helper's db/schema.sql (see
MIGRATION_MAP.md: "REUSE AS FOUNDATION, then EXTEND"). Corrected Aug 19
2026 after a read-only introspection of the actual production Supabase
database found real drift from that file: schema.sql was stale. Production
has 6 additional tables (bench_crimes, chug_debts, season_champions,
season_awards, owner_nicknames, chug_weekly_status) and extra columns on
rosters, weekly_team_stats, rivalries, and chug_scores that schema.sql
never documented — presumably added directly against Supabase as
Fantasy_Helper's features grew, without the file being kept in sync. This
revision now matches the live schema as introspected, not the file.

This revision exists so a fresh dev/CI/test database can be brought up to
match what's actually live in Supabase.

IMPORTANT: the live Supabase database already has these tables — they
were created by hand, not by Alembic. Do NOT run `alembic upgrade`
starting from this revision against that database; it will fail on
already-existing tables. Instead, once this migration chain is reviewed
and approved, the one-time step against the live DB is:

    alembic stamp f8b66c486a5e

which marks this revision as already applied without executing it, so
`alembic upgrade head` from then on only runs the migrations that are
genuinely new (starting with add_users_table). This is a deliberate,
explicit step for a human to run — not something automated here.

Revision ID: f8b66c486a5e
Revises:
Create Date: 2026-08-19 07:11:56.738805

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f8b66c486a5e'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE owners (
            owner_id        SERIAL PRIMARY KEY,
            espn_member_id  TEXT UNIQUE,
            discord_user_id BIGINT UNIQUE,
            display_name    TEXT NOT NULL,
            created_at       TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE teams_by_season (
            id              SERIAL PRIMARY KEY,
            season          INT NOT NULL,
            espn_team_id    INT NOT NULL,
            owner_id        INT NOT NULL REFERENCES owners(owner_id),
            team_name       TEXT NOT NULL,
            UNIQUE (season, espn_team_id)
        )
    """)

    op.execute("""
        CREATE TABLE matchups (
            id              SERIAL PRIMARY KEY,
            season          INT NOT NULL,
            week            INT NOT NULL,
            home_team_id    INT NOT NULL REFERENCES teams_by_season(id),
            away_team_id    INT NOT NULL REFERENCES teams_by_season(id),
            home_score      NUMERIC,
            away_score      NUMERIC,
            home_projected  NUMERIC,
            away_projected  NUMERIC,
            is_playoff      BOOLEAN DEFAULT FALSE,
            UNIQUE (season, week, home_team_id, away_team_id)
        )
    """)

    op.execute("""
        CREATE TABLE rosters (
            id              SERIAL PRIMARY KEY,
            season          INT NOT NULL,
            week            INT NOT NULL,
            team_id         INT NOT NULL REFERENCES teams_by_season(id),
            player_name     TEXT NOT NULL,
            position        TEXT,
            lineup_slot     TEXT,
            points_scored   NUMERIC,
            points_projected NUMERIC,
            is_boom         BOOLEAN DEFAULT FALSE,
            is_bust         BOOLEAN DEFAULT FALSE
        )
    """)

    op.execute("""
        CREATE TABLE weekly_team_stats (
            id                  SERIAL PRIMARY KEY,
            season              INT NOT NULL,
            week                INT NOT NULL,
            team_id             INT NOT NULL REFERENCES teams_by_season(id),
            bench_points        NUMERIC,
            luck_score          NUMERIC,
            chaos_score         NUMERIC,
            clutch_score        NUMERIC,
            choke_score         NUMERIC,
            power_rank          INT,
            team_points_projected NUMERIC,
            UNIQUE (season, week, team_id)
        )
    """)

    op.execute("""
        CREATE TABLE owner_memory_profiles (
            owner_id        INT PRIMARY KEY REFERENCES owners(owner_id),
            tags            JSONB DEFAULT '[]',
            notes           JSONB DEFAULT '{}',
            updated_at      TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE rivalries (
            id                  SERIAL PRIMARY KEY,
            owner_a_id          INT NOT NULL REFERENCES owners(owner_id),
            owner_b_id          INT NOT NULL REFERENCES owners(owner_id),
            all_time_wins_a     INT DEFAULT 0,
            all_time_wins_b     INT DEFAULT 0,
            last_matchup_season INT,
            last_matchup_week   INT,
            biggest_blowout_pts NUMERIC,
            name                TEXT,
            emoji               TEXT,
            tagline             TEXT,
            description         TEXT,
            tier                TEXT,
            UNIQUE (owner_a_id, owner_b_id)
        )
    """)

    op.execute("""
        CREATE TABLE burn_history (
            id              SERIAL PRIMARY KEY,
            owner_id        INT NOT NULL REFERENCES owners(owner_id),
            season          INT NOT NULL,
            week            INT NOT NULL,
            attack_angle    TEXT NOT NULL,
            generated_text  TEXT NOT NULL,
            created_at      TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE excluded_topics (
            id              SERIAL PRIMARY KEY,
            owner_id        INT NOT NULL REFERENCES owners(owner_id),
            topic           TEXT NOT NULL
        )
    """)

    op.execute("""
        CREATE TABLE chug_scores (
            id                  SERIAL PRIMARY KEY,
            discord_user_id     BIGINT NOT NULL,
            video_url           TEXT,
            chug_time_seconds   NUMERIC,
            smoothness_score    NUMERIC,
            hype_score          NUMERIC,
            final_score         NUMERIC,
            created_at          TIMESTAMPTZ DEFAULT now(),
            season              INT,
            week                INT
        )
    """)

    op.execute("""
        CREATE TABLE system_health_log (
            id              SERIAL PRIMARY KEY,
            job_name        TEXT NOT NULL,
            status          TEXT NOT NULL,
            detail          TEXT,
            ran_at          TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE bench_crimes (
            id              SERIAL PRIMARY KEY,
            season          INT NOT NULL,
            week            INT NOT NULL,
            team_id         INT NOT NULL REFERENCES teams_by_season(id),
            bench_player    TEXT NOT NULL,
            started_player  TEXT NOT NULL,
            position        TEXT NOT NULL,
            points_diff     NUMERIC NOT NULL,
            severity        TEXT NOT NULL
        )
    """)

    op.execute("""
        CREATE TABLE chug_debts (
            id              SERIAL PRIMARY KEY,
            season          INT NOT NULL,
            week            INT NOT NULL,
            owner_id        INT NOT NULL REFERENCES owners(owner_id),
            chugs_owed      INT NOT NULL,
            UNIQUE (season, week, owner_id)
        )
    """)

    op.execute("""
        CREATE TABLE season_champions (
            id              SERIAL PRIMARY KEY,
            season          INT NOT NULL,
            owner_id        INT NOT NULL REFERENCES owners(owner_id),
            team_name       TEXT NOT NULL,
            UNIQUE (season)
        )
    """)

    op.execute("""
        CREATE TABLE season_awards (
            id              SERIAL PRIMARY KEY,
            season          INT NOT NULL,
            owner_id        INT NOT NULL REFERENCES owners(owner_id),
            award_type      TEXT NOT NULL,
            detail          TEXT,
            UNIQUE (season, award_type)
        )
    """)

    op.execute("""
        CREATE TABLE owner_nicknames (
            id              SERIAL PRIMARY KEY,
            owner_id        INT NOT NULL REFERENCES owners(owner_id),
            nickname        TEXT NOT NULL UNIQUE
        )
    """)

    op.execute("""
        CREATE TABLE chug_weekly_status (
            id                          SERIAL PRIMARY KEY,
            season                      INT NOT NULL,
            week                        INT NOT NULL,
            owner_id                    INT NOT NULL REFERENCES owners(owner_id),
            base_owed                   INT NOT NULL DEFAULT 0,
            carryover_owed              INT NOT NULL DEFAULT 0,
            total_owed                  INT NOT NULL DEFAULT 0,
            completed_count             INT NOT NULL DEFAULT 0,
            deadline_missed             BOOLEAN DEFAULT FALSE,
            consecutive_missed_weeks    INT NOT NULL DEFAULT 0,
            UNIQUE (season, week, owner_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE chug_weekly_status")
    op.execute("DROP TABLE owner_nicknames")
    op.execute("DROP TABLE season_awards")
    op.execute("DROP TABLE season_champions")
    op.execute("DROP TABLE chug_debts")
    op.execute("DROP TABLE bench_crimes")
    op.execute("DROP TABLE system_health_log")
    op.execute("DROP TABLE chug_scores")
    op.execute("DROP TABLE excluded_topics")
    op.execute("DROP TABLE burn_history")
    op.execute("DROP TABLE rivalries")
    op.execute("DROP TABLE owner_memory_profiles")
    op.execute("DROP TABLE weekly_team_stats")
    op.execute("DROP TABLE rosters")
    op.execute("DROP TABLE matchups")
    op.execute("DROP TABLE teams_by_season")
    op.execute("DROP TABLE owners")
