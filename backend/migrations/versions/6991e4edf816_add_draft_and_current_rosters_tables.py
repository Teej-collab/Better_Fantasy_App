"""add draft and current rosters tables

Three tables for the in-app real-time draft (see the project plan —
Phase B, with current_rosters pulled forward from Phase C since
draft_engine.make_pick() seeds it in the same transaction as each pick):

draft_config is one row per season holding the whole draft's shape and
live state — draft_order (owner_id[], round-1 order; even rounds are
this reversed, computed in app/domain/draft_engine.py, not stored
per-round), roster_slots (JSONB — the starting-lineup shape used by
both the autopick algorithm and lineup validation later), and the live
clock (current_pick_number/current_pick_deadline). All picks for the
whole draft are pre-generated into draft_picks at draft start (server-
computed snake order) rather than inserted one at a time, so the board
is fully knowable before a single pick is made.

current_rosters is this app's own live roster of record going forward —
team_id follows the same teams_by_season(id) FK convention `rosters`/
`matchups` already use, not owner_id directly, for consistency with
those tables. Seeded incrementally as draft picks are made; later
mutated directly by lineup moves/swaps and free-agent add/drop (Phase C)
instead of ESPN's private write API — this is what actually eliminates
the cross-owner ESPN-credential problem that started this whole pivot.

Revision ID: 6991e4edf816
Revises: 67495dc50f68
Create Date: 2026-08-26 15:05:00.722150

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '6991e4edf816'
down_revision: Union[str, Sequence[str], None] = '67495dc50f68'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE draft_config (
            season INTEGER PRIMARY KEY,
            draft_type TEXT NOT NULL DEFAULT 'snake',
            pick_time_limit_seconds INTEGER NOT NULL DEFAULT 90,
            draft_order INTEGER[] NOT NULL,
            roster_slots JSONB NOT NULL,
            status TEXT NOT NULL DEFAULT 'not_started',
            current_pick_number INTEGER NOT NULL DEFAULT 1,
            current_pick_deadline TIMESTAMPTZ,
            paused_remaining_seconds INTEGER,
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE draft_picks (
            id SERIAL PRIMARY KEY,
            season INTEGER NOT NULL,
            pick_number INTEGER NOT NULL,
            round INTEGER NOT NULL,
            round_pick INTEGER NOT NULL,
            owner_id INTEGER NOT NULL REFERENCES owners(owner_id),
            sleeper_player_id TEXT REFERENCES players(sleeper_player_id),
            is_autopick BOOLEAN NOT NULL DEFAULT FALSE,
            is_keeper BOOLEAN NOT NULL DEFAULT FALSE,
            made_at TIMESTAMPTZ,
            UNIQUE (season, pick_number)
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX draft_picks_one_player_per_season "
        "ON draft_picks (season, sleeper_player_id) WHERE sleeper_player_id IS NOT NULL"
    )
    op.execute(
        """
        CREATE TABLE current_rosters (
            id SERIAL PRIMARY KEY,
            season INTEGER NOT NULL,
            team_id INTEGER NOT NULL REFERENCES teams_by_season(id),
            sleeper_player_id TEXT NOT NULL REFERENCES players(sleeper_player_id),
            lineup_slot TEXT NOT NULL DEFAULT 'BE',
            acquired_via TEXT NOT NULL DEFAULT 'draft',
            acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (season, team_id, sleeper_player_id),
            UNIQUE (season, sleeper_player_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE current_rosters")
    op.execute("DROP TABLE draft_picks")
    op.execute("DROP TABLE draft_config")
