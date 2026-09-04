# Admin Dashboard

The Weekend's admin/product-intelligence dashboard, at `/admin` — visible only to the site owner (League #1's commissioner; see `ADMIN_SECURITY.md`). Built in phases; this document describes Phase 1, what it deliberately left out and why, and what a real Phase 2 looks like.

## Why phases

The original request for this was large — DAU/WAU/MAU, retention curves, funnels, error monitoring, security monitoring, device breakdowns, a real-time activity feed, an admin audit log, path/Sankey diagrams. Some of that needs data that doesn't exist yet and can't be fabricated (retention needs users who signed up weeks ago; a trend line needs history). Some of it needs an entirely separate subsystem that doesn't exist at all (error logging, security-event logging). Building the *dashboards* for those today would mean either faking numbers or shipping permanently-empty cards — building the actual underlying pipeline is the real work, and it's substantial enough to be its own phase.

Phase 1 is everything that's honest to ship today: real events, real KPIs, real search/filter, a real heat map — nothing invented.

## Architecture

```
Frontend page load / route change
        │
        ▼
frontend/src/lib/analyticsEvents.ts (classify route, attach session/device)
        │
        ▼
POST /admin/track  (any signed-in owner; owner_id from session, never the body)
        │
        ▼
backend/app/analytics/taxonomy.py — validate_event() rejects anything
not in the fixed taxonomy before it's ever written
        │
        ▼
analytics_events table
        │
        ▼
GET /admin/overview | /navigation | /features | /users | /leagues
(site-owner-only — see ADMIN_SECURITY.md)
        │
        ▼
/admin/* pages
```

### Data model

`analytics_events` (see `backend/migrations/versions/c8ca9b06b451_*`), the direct successor to the single-purpose `page_view_events` table from the previous iteration of this feature — that table's own history is preserved via a one-time backfill in the same migration, not discarded.

| Column | Notes |
|---|---|
| `owner_id` | Always server-derived from the session. Never client-supplied. |
| `session_id` | Client-generated UUID, one per browser tab (see `ANALYTICS_EVENTS.md`). |
| `event_name` / `event_type` | Validated against `app/analytics/taxonomy.py` before insert. |
| `route` | Raw pathname, for `page_view` events. |
| `league_id` | Nullable — only `feature` events that are inherently league-scoped set this today (see "League attribution" below). |
| `metadata` | JSONB, allowlisted per event_name — never raw client JSON. |
| `device_type` / `platform` | Coarse classification, not full UA parsing. |

Indexed on `created_at`, `(owner_id, created_at)`, `(event_name, created_at)`, and `session_id` — every aggregate query in Phase 1 is server-side SQL over these indexes, nothing is loaded into the browser to filter client-side.

### League attribution (a real Phase 1 limitation)

`page_view` events don't carry a `league_id` — most routes aren't unambiguously "about" one league from the URL alone, and a visitor's active league can change independent of which page they're on. League-level "activity" in Phase 1 (`GET /admin/leagues`) is therefore *approximated*: a league's activity is its own members' overall event volume, not exact per-event attribution. This is disclosed directly in the Leagues page UI, not hidden. Sharpening this (having every event report which league was active when it fired) is real, straightforward future work if it turns out to matter.

## What Phase 1 actually ships

- **Overview** (`/admin`) — Total Users, Active Users, New Users, Active Leagues, Online Now (all real, all for the selected window), captioned with "Tracking since {date}" so a small number reads as "collection just started," not "nobody's here." A top-5 page preview and the live online list.
- **Users** (`/admin/users`) — server-side search (name/email/user ID) and filters (Active/Inactive/New/Commissioner/Multiple Leagues/No League — no Verified/Unverified filter, since this app has no email-verification concept at all; adding a fake one would be exactly the fabrication the original spec explicitly ruled out).
- **User detail** (`/admin/users/[id]`) — account info, real league memberships, a real activity timeline built from `analytics_events`. Never renders `password_hash`, tokens, or push credentials (the backing query never even selects them — see `ADMIN_SECURITY.md`).
- **Leagues** (`/admin/leagues`) — every league, member counts, an approximated activity signal (see above).
- **League detail** (`/admin/leagues/[id]`) — members, roles, teams, per-member last-active and recent-event counts.
- **Navigation** (`/admin/navigation`) — a real visual heat map over every route in the taxonomy, switchable across 7/30/90-day windows, plus a small Feature Usage table for the curated `feature` events.

## What's explicitly NOT built yet, and why

| Feature | Why not Phase 1 |
|---|---|
| DAU/WAU/MAU **trend lines**, retention (Day 1/7/30) | Needs weeks of real history to mean anything — a trend line with three days of data is noise, and retention needs cohorts of users who signed up 7–30+ days ago. |
| Error monitoring | Needs an actual error-logging pipeline — today, errors only go to Railway's stdout logs, nothing queryable. Real Phase 2 work, not a dashboard afterthought. |
| Security monitoring (failed logins, permission-denial events) | Same — needs a new logging table and instrumentation at every auth boundary. Real Phase 2 work. |
| Admin audit log | Needs its own table + instrumenting every admin action. Small, but not free — Phase 2. |
| Role hierarchy (Owner/Admin/Support/Analyst/Moderator) | Explicitly deferred at the owner's own direction — one real admin exists today; `is_site_owner` is a clean, sufficient boundary until a second one is ever needed. |
| Click-level tracking | Deliberately never planned as "track everything" — see `ANALYTICS_EVENTS.md`'s own note on why a raw click logger produces noise, not intelligence. |
| Real-time live activity feed | Straightforward to add later (the presence WebSocket pattern already exists twice in this codebase — chat and draft); not in Phase 1's scope. |
| Path/Sankey-style navigation diagrams | The heat map covers "what's used, how much" today; sequence/path visualization is a real, separate visualization effort for later. |
| Funnels (registration, league creation, Gamecast) | Buildable once there's enough real event volume to make a funnel meaningful — the event taxonomy this needs already exists, this is a query + UI, not new infrastructure. |
| Offline/PWA event queuing | A real edge case at this league's size; not worth the complexity yet. |

## Extending the taxonomy

Adding a new `feature` event: add it to `FEATURE_EVENTS` in **both** `backend/app/analytics/taxonomy.py` and `frontend/src/lib/analyticsEvents.ts`, document it in `ANALYTICS_EVENTS.md`, and add a `track*` helper in `analyticsEvents.ts` for the real call site. The backend independently rejects anything not listed in its own copy, regardless of what the frontend sends — the two files are meant to agree, but the backend is what's actually trusted.

Adding a new route to the nav taxonomy: add a prefix entry to `_ROUTE_PREFIXES` in both taxonomy files (and the migration's one-time SQL mirror, if a historical backfill matters), plus a label in `frontend/src/lib/analyticsEvents.ts`'s `EVENT_LABELS`.
