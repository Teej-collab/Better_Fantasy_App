"""add lounge_rooms table for standalone password-protected video rooms

Lounge is a brand-new, deliberately standalone feature (2026-09 plan) —
NOT a league-scoped concept and NOT related to Watch Party's own
"League Lounge" open room (app/routers/watch_party.py,
watch_party_rooms with kind='open'), which is a different, unrelated
thing that keeps its existing name. A Lounge room requires a signed-in
users.id to CREATE (any real account — league membership not required,
same as email/password signup in app/routers/auth.py, which never
requires a league) but requires nothing at all to JOIN beyond the
room's public slug plus its password, typed separately every time —
the invite link itself never embeds the password (see
app/routers/lounge.py's own docstring). created_by_user_id therefore
references users(id), not owners(owner_id) — an owner row only exists
once someone has actually joined/created a league, and Lounge is
reachable by accounts that never have.

slug is the public, URL-safe identifier a join link actually contains
(secrets.token_urlsafe, same unguessable-token idiom as
leagues.invite_code, but with more entropy: unlike a league invite
code, this is reachable by a fully anonymous visitor with no rate
limiting in front of it at the network layer, so slug guessing has to
be infeasible on its own). password_hash is bcrypt via
app/auth/passwords.py, the same helper email/password login already
uses — never the raw password, never logged.

failed_attempts/locked_until implement brute-force lockout directly on
this row rather than via a separate infra piece: there is no
Redis/rate-limiter dependency anywhere in backend/requirements.txt
today, and POST /lounge/rooms/{slug}/join is reachable with zero auth,
so it's the one Lounge endpoint that actually needs this. Reset to
(0, NULL) on a successful join; failed_attempts increments and
locked_until gets set once a threshold is crossed on a wrong password —
see queries/lounge.py's record_failed_join_attempt for the exact
mechanics. Per-room, not per-IP/global: simpler, no extra column/index
for an IP, and sufficient for this feature's actual threat model (a
stranger guessing one room's password), not a general WAF.

closed_at (nullable, like watch_party_rooms.closed_at) marks a room the
creator has explicitly shut down — join/metadata routes both treat a
closed room as unavailable, but the row itself is kept (not deleted) so
a creator's "My Lounges" history stays intact.

Revision ID: 73b78b034f05
Revises: 4b0f790da9c8
Create Date: 2026-09-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = '73b78b034f05'
down_revision: Union[str, Sequence[str], None] = '4b0f790da9c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE lounge_rooms (
            id                 SERIAL PRIMARY KEY,
            slug               TEXT NOT NULL UNIQUE,
            name               TEXT NOT NULL,
            password_hash      TEXT NOT NULL,
            created_by_user_id INT NOT NULL REFERENCES users(id),
            failed_attempts    INT NOT NULL DEFAULT 0,
            locked_until       TIMESTAMPTZ,
            closed_at          TIMESTAMPTZ,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX lounge_rooms_created_by_user_id_idx ON lounge_rooms (created_by_user_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE lounge_rooms")
