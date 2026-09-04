"""generalize page view events into analytics events

Phase 1 of the admin/product-intelligence dashboard (2026-09-04) —
page_view_events (owner_id, path, created_at only) becomes
analytics_events: a real event taxonomy (event_name, event_type —
see app/analytics/taxonomy.py, the single source of truth both this
backfill and the frontend's trackEvent() calls stay in sync with),
a session_id (page_view_events had no session concept at all), a
validated metadata blob (never raw client JSON — see taxonomy.py's
validate_event), and device_type/platform capture.

Backfills every existing page_view_events row rather than discarding
it — the CASE statement below is a one-time, self-contained SQL
mirror of taxonomy.py's classify_route() (migrations intentionally
never import app code, so app code changing shape later can't break
replaying this migration); it doesn't need to stay in sync with that
function going forward, it only ever runs once, now. session_id is
'legacy' for every backfilled row (the real concept didn't exist yet
when they were recorded) — a real, honest placeholder rather than a
guess.

Revision ID: c8ca9b06b451
Revises: 2587a1c96f73
Create Date: 2026-09-04 14:38:00.398919

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c8ca9b06b451'
down_revision: Union[str, Sequence[str], None] = '2587a1c96f73'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CLASSIFY_ROUTE_SQL = """
    CASE
        WHEN path = '/' THEN 'nav_home'
        WHEN path LIKE '/seasons%' THEN 'nav_seasons'
        WHEN path LIKE '/standings%' THEN 'nav_standings'
        WHEN path LIKE '/matchups%' THEN 'nav_matchups'
        WHEN path LIKE '/gamecast%' THEN 'nav_gamecast'
        WHEN path LIKE '/history%' THEN 'nav_history'
        WHEN path LIKE '/rivalries%' THEN 'nav_rivalries'
        WHEN path LIKE '/rules%' THEN 'nav_rules'
        WHEN path LIKE '/power-rankings%' THEN 'nav_power_rankings'
        WHEN path LIKE '/draft%' THEN 'nav_draft'
        WHEN path LIKE '/keepers%' THEN 'nav_keepers'
        WHEN path LIKE '/free-agents%' THEN 'nav_free_agents'
        WHEN path LIKE '/trades%' THEN 'nav_trades'
        WHEN path LIKE '/teams%' THEN 'nav_teams'
        WHEN path LIKE '/team%' THEN 'nav_team'
        WHEN path LIKE '/players%' THEN 'nav_players'
        WHEN path LIKE '/leagues%' THEN 'nav_leagues'
        WHEN path LIKE '/league%' THEN 'nav_league'
        WHEN path LIKE '/chat%' THEN 'nav_chat'
        WHEN path LIKE '/chug%' THEN 'nav_chug'
        WHEN path LIKE '/owners%' THEN 'nav_owners'
        WHEN path LIKE '/settings%' THEN 'nav_settings'
        WHEN path LIKE '/commissioner%' THEN 'nav_commissioner'
        WHEN path LIKE '/admin%' THEN 'nav_admin'
        WHEN path LIKE '/weekend%' THEN 'nav_weekend'
        WHEN path LIKE '/login%' THEN 'nav_login'
        ELSE 'nav_other'
    END
"""


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE analytics_events (
            id BIGSERIAL PRIMARY KEY,
            owner_id INT NOT NULL REFERENCES owners(owner_id),
            session_id TEXT NOT NULL,
            event_name TEXT NOT NULL,
            event_type TEXT NOT NULL CHECK (event_type IN ('page_view', 'feature')),
            route TEXT,
            league_id INT REFERENCES leagues(id),
            metadata JSONB NOT NULL DEFAULT '{}',
            device_type TEXT,
            platform TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX idx_analytics_events_created_at ON analytics_events(created_at)")
    op.execute("CREATE INDEX idx_analytics_events_owner_id ON analytics_events(owner_id, created_at)")
    op.execute("CREATE INDEX idx_analytics_events_event_name ON analytics_events(event_name, created_at)")
    op.execute("CREATE INDEX idx_analytics_events_session_id ON analytics_events(session_id)")

    op.execute(
        f"""
        INSERT INTO analytics_events (owner_id, session_id, event_name, event_type, route, created_at)
        SELECT owner_id, 'legacy', {_CLASSIFY_ROUTE_SQL}, 'page_view', path, created_at
        FROM page_view_events
        """
    )
    op.execute("DROP TABLE page_view_events")


def downgrade() -> None:
    op.execute(
        """
        CREATE TABLE page_view_events (
            id SERIAL PRIMARY KEY,
            owner_id INT NOT NULL REFERENCES owners(owner_id),
            path TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX idx_page_view_events_created_at ON page_view_events(created_at)")
    op.execute("CREATE INDEX idx_page_view_events_owner_id ON page_view_events(owner_id)")
    op.execute(
        """
        INSERT INTO page_view_events (owner_id, path, created_at)
        SELECT owner_id, COALESCE(route, event_name), created_at
        FROM analytics_events WHERE event_type = 'page_view'
        """
    )
    op.execute("DROP TABLE analytics_events")
