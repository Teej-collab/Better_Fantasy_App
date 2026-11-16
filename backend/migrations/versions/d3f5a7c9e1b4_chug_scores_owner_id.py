"""Chug scores keyed on owner_id, so owners without Discord can post

chug_scores came from the old Discord bot and only knew who chugged by
discord_user_id (NOT NULL), so an owner who signs in with email/Google
and never linked Discord got "needs to be linked to Discord" on every
upload (Ryan, 2026-11-16). Each row now carries owner_id; discord_user_id
stays for history but is optional. owners.discord_user_id is UNIQUE, so
the backfill is one-to-one.

A trigger fills owner_id from discord_user_id on insert, so anything
still writing only discord_user_id (older tests, the old bot) keeps
showing up on the board.

Revision ID: d3f5a7c9e1b4
Revises: c2e4a6b8d0f1
Create Date: 2026-11-16
"""
from alembic import op

revision = "d3f5a7c9e1b4"
down_revision = "c2e4a6b8d0f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE chug_scores ADD COLUMN owner_id INTEGER REFERENCES owners(owner_id)")
    op.execute(
        """
        UPDATE chug_scores cs SET owner_id = o.owner_id
        FROM owners o WHERE o.discord_user_id = cs.discord_user_id
        """
    )
    op.execute("ALTER TABLE chug_scores ALTER COLUMN discord_user_id DROP NOT NULL")
    op.execute("CREATE INDEX chug_scores_owner_idx ON chug_scores (owner_id)")
    op.execute(
        """
        CREATE FUNCTION chug_scores_fill_owner_id() RETURNS trigger AS $$
        BEGIN
            IF NEW.owner_id IS NULL AND NEW.discord_user_id IS NOT NULL THEN
                SELECT owner_id INTO NEW.owner_id FROM owners WHERE discord_user_id = NEW.discord_user_id;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER chug_scores_fill_owner_id BEFORE INSERT ON chug_scores
        FOR EACH ROW EXECUTE FUNCTION chug_scores_fill_owner_id()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER chug_scores_fill_owner_id ON chug_scores")
    op.execute("DROP FUNCTION chug_scores_fill_owner_id()")
    # Chugs from owners with no Discord can't be kept under the old key.
    op.execute("DELETE FROM chug_scores WHERE discord_user_id IS NULL")
    op.execute("ALTER TABLE chug_scores ALTER COLUMN discord_user_id SET NOT NULL")
    op.execute("DROP INDEX chug_scores_owner_idx")
    op.execute("ALTER TABLE chug_scores DROP COLUMN owner_id")
