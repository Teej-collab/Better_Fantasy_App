"""add bet tracking

Tracking only — the app never places a bet or moves money. A bet is
private to the user who added it (user_id, not owner_id, so two
co-owners of one team each keep their own) until they choose to share
it to their league's chat, which sets shared_at and posts a chat message
carrying messages.bet_id; league members can then read that one bet.

bets: one slip (a single bet or a parlay). Money is stored in cents and
odds as American odds, both as entered or read off the slip.
bet_legs: one row per pick. A player prop names a stat (bets domain's
STAT_KEYS) with a line and a direction; a game line (moneyline, spread,
total) names a team or the game. espn_event_id ties a leg to its NFL
game, which is how the Gamecast finds the legs riding on it. A leg's
status is settled from the final box score once its game ends.

owner_preferences.bet_tracking_enabled: Settings' switch for the whole
feature (on by default; off hides My Bets and the Gamecast card).

Revision ID: d7a2c4e8f1b9
Revises: c5e1a9d3f7b2
Create Date: 2026-10-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd7a2c4e8f1b9'
down_revision: Union[str, Sequence[str], None] = 'c5e1a9d3f7b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE bets (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            owner_id INTEGER REFERENCES owners(owner_id) ON DELETE SET NULL,
            league_id INTEGER,
            sportsbook TEXT,
            stake_cents INTEGER,
            odds_american INTEGER,
            payout_cents INTEGER,
            status TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'won', 'lost', 'push', 'void', 'cashed_out')),
            -- Set when the user marks the result themselves (cash-outs,
            -- a leg the app can't grade); automatic settling never
            -- overrides it.
            status_set_manually BOOLEAN NOT NULL DEFAULT FALSE,
            source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('screenshot', 'manual')),
            note TEXT,
            shared_at TIMESTAMPTZ,
            placed_at TIMESTAMPTZ,
            settled_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX bets_user_idx ON bets (user_id, created_at DESC)")
    op.execute(
        """
        CREATE TABLE bet_legs (
            id SERIAL PRIMARY KEY,
            bet_id INTEGER NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
            position INTEGER NOT NULL DEFAULT 0,
            description TEXT NOT NULL,
            market TEXT NOT NULL CHECK (market IN ('player_prop', 'moneyline', 'spread', 'total', 'other')),
            player_name TEXT,
            espn_player_id INTEGER,
            sleeper_player_id TEXT,
            team_abbr TEXT,
            stat_key TEXT,
            line NUMERIC,
            direction TEXT CHECK (direction IN ('over', 'under', 'yes', 'no')),
            odds_american INTEGER,
            espn_event_id TEXT,
            status TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'won', 'lost', 'push', 'void')),
            final_value NUMERIC,
            settled_at TIMESTAMPTZ
        )
        """
    )
    op.execute("CREATE INDEX bet_legs_bet_idx ON bet_legs (bet_id, position)")
    op.execute("CREATE INDEX bet_legs_event_idx ON bet_legs (espn_event_id)")
    op.execute("ALTER TABLE messages ADD COLUMN bet_id INTEGER REFERENCES bets(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE owner_preferences ADD COLUMN bet_tracking_enabled BOOLEAN NOT NULL DEFAULT TRUE")


def downgrade() -> None:
    op.execute("ALTER TABLE owner_preferences DROP COLUMN bet_tracking_enabled")
    op.execute("ALTER TABLE messages DROP COLUMN bet_id")
    op.execute("DROP TABLE bet_legs")
    op.execute("DROP TABLE bets")
