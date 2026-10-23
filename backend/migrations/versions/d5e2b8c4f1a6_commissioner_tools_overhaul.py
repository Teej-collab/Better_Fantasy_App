"""Commissioner Tools overhaul: waiver settings, a change log, scheduled
Commish Corner posts

- league_waiver_settings: a league's own waiver rules, editable by its
  commissioner (Commissioner → Waivers). No row means the rules every
  league has run on so far: a rolling line (FAAB in a guillotine
  league), claims clearing Wednesday 3:00 AM ET, dropped players on
  waivers for 1 day, and players held once their game starts.
- commish_changes: every change a commissioner makes, for the change
  log the commissioner (and, unless turned off, the league) can read.
  leagues.commish_log_public is that switch.
- scheduled_announcements: Commish Corner posts set to go out later;
  the scheduler posts each once send_at passes.

Purely additive: one new column with a default, three new tables.

Revision ID: d5e2b8c4f1a6
Revises: c3f1a7d9e5b2
Create Date: 2026-10-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'd5e2b8c4f1a6'
down_revision: Union[str, Sequence[str], None] = 'c3f1a7d9e5b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE league_waiver_settings (
            league_id INTEGER PRIMARY KEY REFERENCES leagues(id) ON DELETE CASCADE,
            waiver_type TEXT NOT NULL CHECK (waiver_type IN ('rolling', 'faab', 'reverse')),
            faab_budget INTEGER NOT NULL DEFAULT 100 CHECK (faab_budget BETWEEN 1 AND 10000),
            min_bid INTEGER NOT NULL DEFAULT 0 CHECK (min_bid >= 0),
            clear_weekday SMALLINT NOT NULL DEFAULT 2 CHECK (clear_weekday BETWEEN 0 AND 6),
            clear_hour SMALLINT NOT NULL DEFAULT 3 CHECK (clear_hour BETWEEN 0 AND 23),
            drop_days SMALLINT NOT NULL DEFAULT 1 CHECK (drop_days BETWEEN 0 AND 7),
            hold_played BOOLEAN NOT NULL DEFAULT true,
            post_results BOOLEAN NOT NULL DEFAULT false,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE commish_changes (
            id SERIAL PRIMARY KEY,
            league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
            actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            area TEXT NOT NULL,
            summary TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX commish_changes_league_created ON commish_changes (league_id, created_at DESC)")
    op.execute("ALTER TABLE leagues ADD COLUMN commish_log_public BOOLEAN NOT NULL DEFAULT true")
    op.execute(
        """
        CREATE TABLE scheduled_announcements (
            id SERIAL PRIMARY KEY,
            league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
            author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            notify BOOLEAN NOT NULL DEFAULT true,
            send_at TIMESTAMPTZ NOT NULL,
            sent_at TIMESTAMPTZ,
            message_id INTEGER,
            cancelled_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX scheduled_announcements_due ON scheduled_announcements (send_at) "
        "WHERE sent_at IS NULL AND cancelled_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS scheduled_announcements")
    op.execute("ALTER TABLE leagues DROP COLUMN IF EXISTS commish_log_public")
    op.execute("DROP TABLE IF EXISTS commish_changes")
    op.execute("DROP TABLE IF EXISTS league_waiver_settings")
