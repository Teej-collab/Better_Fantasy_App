"""Keeper costs, franchise tag fees, the league kitty, the offseason
roster lock and tradeable future draft picks

- league_keeper_rules.cost_mode: what a keeper costs. 'last_round'
  (ESPN's default: your final picks), 'round_drafted' (the round he
  went in last year; a free-agent pickup costs the last round) or
  'escalating' (the same, a cost_step rounds earlier for every year
  he's been kept).
- league_keeper_rules.tag_fees: a franchise tag fee by year kept, in
  dollars ([0, 10, 25]: year 1 free, $10, $25), on top of the pick. Null:
  no fees. Fees go to the kitty when keepers lock.
- league_kitty_entries: the league's money ledger (tag fees, anything
  the commissioner adds), each marked paid by the commissioner.
- leagues.offseason_lock: no free-agent or rookie pickups between the
  end of the season and the draft, until offseason_cleared_season is
  set to that season by the commissioner.
- future_picks: next seasons' draft picks in keeper and dynasty
  leagues, one row per round per team, with who owns it now.
- trade_assets.future_pick_id: a trade can move picks as well as
  players; a row is one or the other.

Revision ID: e1a3c5d7f9b2
Revises: c8e0a2d4f6b9
Create Date: 2026-10-28 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'e1a3c5d7f9b2'
down_revision: Union[str, Sequence[str], None] = 'c8e0a2d4f6b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE league_keeper_rules
            ADD COLUMN cost_mode TEXT NOT NULL DEFAULT 'last_round'
                CHECK (cost_mode IN ('last_round', 'round_drafted', 'escalating')),
            ADD COLUMN cost_step INT NOT NULL DEFAULT 1 CHECK (cost_step BETWEEN 1 AND 5),
            ADD COLUMN tag_fees JSONB
    """)
    op.execute("""
        CREATE TABLE league_kitty_entries (
            id          SERIAL PRIMARY KEY,
            league_id   INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
            season      INT NOT NULL,
            owner_id    INT REFERENCES owners(owner_id) ON DELETE SET NULL,
            amount      NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
            reason      TEXT NOT NULL,
            source_key  TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            paid_at     TIMESTAMPTZ,
            UNIQUE (league_id, source_key)
        )
    """)
    op.execute("CREATE INDEX league_kitty_league_idx ON league_kitty_entries (league_id, season)")
    op.execute("""
        ALTER TABLE leagues
            ADD COLUMN offseason_lock BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN offseason_cleared_season INT
    """)
    op.execute("""
        CREATE TABLE future_picks (
            id                  SERIAL PRIMARY KEY,
            league_id           INT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
            season              INT NOT NULL,
            round               INT NOT NULL CHECK (round >= 1),
            original_owner_id   INT NOT NULL REFERENCES owners(owner_id),
            owner_id            INT NOT NULL REFERENCES owners(owner_id),
            UNIQUE (league_id, season, round, original_owner_id)
        )
    """)
    op.execute("CREATE INDEX future_picks_owner_idx ON future_picks (league_id, owner_id)")
    op.execute("ALTER TABLE trade_assets ALTER COLUMN sleeper_player_id DROP NOT NULL")
    op.execute("ALTER TABLE trade_assets ADD COLUMN future_pick_id INT REFERENCES future_picks(id) ON DELETE CASCADE")
    op.execute("""
        ALTER TABLE trade_assets ADD CONSTRAINT trade_assets_player_or_pick
            CHECK ((sleeper_player_id IS NULL) <> (future_pick_id IS NULL))
    """)


def downgrade() -> None:
    op.execute("DELETE FROM trade_assets WHERE future_pick_id IS NOT NULL")
    op.execute("ALTER TABLE trade_assets DROP CONSTRAINT IF EXISTS trade_assets_player_or_pick")
    op.execute("ALTER TABLE trade_assets DROP COLUMN future_pick_id")
    op.execute("ALTER TABLE trade_assets ALTER COLUMN sleeper_player_id SET NOT NULL")
    op.execute("DROP TABLE future_picks")
    op.execute("ALTER TABLE leagues DROP COLUMN offseason_cleared_season, DROP COLUMN offseason_lock")
    op.execute("DROP TABLE league_kitty_entries")
    op.execute("ALTER TABLE league_keeper_rules DROP COLUMN tag_fees, DROP COLUMN cost_step, DROP COLUMN cost_mode")
