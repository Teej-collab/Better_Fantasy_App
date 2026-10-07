"""leagues: format — league type, matchups, draft style, roster preset

The Create a League flow's new League Type step (2026-10). Each league
records what kind it is, how matchups are decided and how it drafts;
the type's own options (keepers per team, taxi squad size, rookie
draft rounds, bench size, FAAB budget, auction budget) go in
type_settings.

- league_type: redraft | keeper | dynasty | bestball | guillotine.
- matchup_type: h2h (win your week) | points (most total points ranks first).
- draft_type: snake | auction.
- roster_preset: standard | superflex | 2qb | idp — the shape picked at
  creation. The real slot counts still live in draft_config /
  league_roster_slots_settings, which a commissioner can fine-tune.

Existing leagues keep working as they do: League #1 runs keepers, so it
starts as 'keeper'; every other existing league is 'redraft'.

Revision ID: f1a3c5e7b9d2
Revises: e8b4d1f7a2c6
Create Date: 2026-10-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f1a3c5e7b9d2'
down_revision: Union[str, Sequence[str], None] = 'e8b4d1f7a2c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE leagues
            ADD COLUMN league_type TEXT NOT NULL DEFAULT 'redraft'
                CHECK (league_type IN ('redraft', 'keeper', 'dynasty', 'bestball', 'guillotine')),
            ADD COLUMN matchup_type TEXT NOT NULL DEFAULT 'h2h'
                CHECK (matchup_type IN ('h2h', 'points')),
            ADD COLUMN draft_type TEXT NOT NULL DEFAULT 'snake'
                CHECK (draft_type IN ('snake', 'auction')),
            ADD COLUMN roster_preset TEXT NOT NULL DEFAULT 'standard'
                CHECK (roster_preset IN ('standard', 'superflex', '2qb', 'idp')),
            ADD COLUMN type_settings JSONB NOT NULL DEFAULT '{}'::jsonb
        """
    )
    op.execute(
        """
        UPDATE leagues SET league_type = 'keeper'
        WHERE id IN (SELECT league_id FROM league_keeper_rules WHERE max_keepers > 0)
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE leagues
            DROP COLUMN type_settings,
            DROP COLUMN roster_preset,
            DROP COLUMN draft_type,
            DROP COLUMN matchup_type,
            DROP COLUMN league_type
        """
    )
