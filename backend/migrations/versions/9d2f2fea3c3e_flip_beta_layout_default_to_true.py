"""flip beta_layout's column default to true — new-layout nav is now the default

Commissioner call (per 06_Implementation_Roadmap.md section 0's own
documented rollout plan: "opt-in beta -> default -> retire old UI"),
made 2026-09-16: the redesigned nav (hamburger drawer, no bottom tab
bar) and flatter card styling become what every owner sees by
default, not something they have to find in Settings > Labs first.

This only changes the Postgres-level DEFAULT (relevant if anything
ever inserts a row without specifying every column — today's app code
never does, see owner_preferences.py's _upsert, which always supplies
every column explicitly from _DEFAULT_PREFERENCES merged with the
caller's patch). The two things that actually matter for real owners
are handled elsewhere, deliberately not folded into a schema
migration:
- _DEFAULT_PREFERENCES["beta_layout"] in owner_preferences.py (same
  commit) — what a *missing* row resolves to.
- A one-time, explicitly-approved UPDATE against the 9 existing rows
  that had beta_layout=false stored (run directly, not via a
  migration's upgrade(), since it's a one-time data backfill tied to
  this specific rollout decision, not a repeatable schema change).

Explicitly NOT deleting the toggle, the legacy nav components
(PrimaryNav/BottomNav), or this column's CHECK-free boolean shape —
the toggle stays as a real opt-out escape hatch per this rollout's own
"Keep it as an opt-out" decision, not the roadmap doc's eventual (and
separate) full-removal step.

Revision ID: 9d2f2fea3c3e
Revises: 7741844fd3c9
Create Date: 2026-09-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '9d2f2fea3c3e'
down_revision: Union[str, Sequence[str], None] = '7741844fd3c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE owner_preferences ALTER COLUMN beta_layout SET DEFAULT true")


def downgrade() -> None:
    op.execute("ALTER TABLE owner_preferences ALTER COLUMN beta_layout SET DEFAULT false")
