"""survivor pools

NFL survivor pools (2026-11-07), like Sleeper's Survivor and ESPN's
Eliminator: each week every entry picks NFL teams to win, never the same
team twice; a loss costs a life and running out of lives is elimination.

- survivor_pools: one pool and its rules. league_id set = a league's
  pool (its commissioner runs it, its members join); NULL = standalone,
  joined with the code. start_week: the first week picked; lives 1–3;
  tie_counts_as 'win' | 'loss'; buyback_until_week: an eliminated entry
  may buy back in (one life, once) through this week; double_from_week:
  two picks a week from this week on; missed_pick 'auto' (we pick the
  biggest favorite left) | 'loss'; max_entries per person.
- survivor_entries: one person's run in a pool (a person may have up
  to max_entries). Elimination is worked out from the graded picks, but
  stored (eliminated_week) so lists don't recompute it.
- survivor_picks: one team per entry, week and slot (slot 2 only in
  double-pick weeks). team NULL = a missed pick that counted as a loss.
  kickoff is the game's start: the pick locks then, and only then do
  other people see it. result 'win' | 'loss' | 'tie' | 'missed' once
  the game is final.
- survivor_reminders: which "make your pick" pushes went out, so each
  goes once.

Revision ID: f7c9e1a3b5d4
Revises: e5a7c9b1d3f2
Create Date: 2026-11-07
"""
from typing import Sequence, Union

from alembic import op

revision: str = "f7c9e1a3b5d4"
down_revision: Union[str, None] = "e5a7c9b1d3f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE survivor_pools (
            id SERIAL PRIMARY KEY,
            season INTEGER NOT NULL,
            name TEXT NOT NULL,
            league_id INTEGER REFERENCES leagues(id),
            created_by INTEGER NOT NULL REFERENCES users(id),
            join_code TEXT NOT NULL UNIQUE,
            start_week INTEGER NOT NULL CHECK (start_week BETWEEN 1 AND 18),
            lives INTEGER NOT NULL DEFAULT 1 CHECK (lives BETWEEN 1 AND 3),
            tie_counts_as TEXT NOT NULL DEFAULT 'loss' CHECK (tie_counts_as IN ('win', 'loss')),
            buyback_until_week INTEGER CHECK (buyback_until_week BETWEEN 1 AND 18),
            double_from_week INTEGER CHECK (double_from_week BETWEEN 1 AND 18),
            missed_pick TEXT NOT NULL DEFAULT 'auto' CHECK (missed_pick IN ('auto', 'loss')),
            max_entries INTEGER NOT NULL DEFAULT 1 CHECK (max_entries BETWEEN 1 AND 3),
            prize_note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_survivor_pools_league ON survivor_pools (league_id) WHERE league_id IS NOT NULL")
    op.execute(
        """
        CREATE TABLE survivor_entries (
            id SERIAL PRIMARY KEY,
            pool_id INTEGER NOT NULL REFERENCES survivor_pools(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            entry_no INTEGER NOT NULL CHECK (entry_no BETWEEN 1 AND 3),
            bought_back BOOLEAN NOT NULL DEFAULT FALSE,
            eliminated_week INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (pool_id, user_id, entry_no)
        )
        """
    )
    op.execute("CREATE INDEX ix_survivor_entries_user ON survivor_entries (user_id)")
    op.execute(
        """
        CREATE TABLE survivor_picks (
            id SERIAL PRIMARY KEY,
            entry_id INTEGER NOT NULL REFERENCES survivor_entries(id) ON DELETE CASCADE,
            week INTEGER NOT NULL,
            slot INTEGER NOT NULL DEFAULT 1 CHECK (slot IN (1, 2)),
            team TEXT,
            kickoff TIMESTAMPTZ,
            auto BOOLEAN NOT NULL DEFAULT FALSE,
            result TEXT CHECK (result IN ('win', 'loss', 'tie', 'missed')),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (entry_id, week, slot),
            UNIQUE (entry_id, team)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE survivor_reminders (
            entry_id INTEGER NOT NULL REFERENCES survivor_entries(id) ON DELETE CASCADE,
            week INTEGER NOT NULL,
            kind TEXT NOT NULL,
            sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (entry_id, week, kind)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE survivor_reminders")
    op.execute("DROP TABLE survivor_picks")
    op.execute("DROP TABLE survivor_entries")
    op.execute("DROP TABLE survivor_pools")
