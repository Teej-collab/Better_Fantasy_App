# Admin Dashboard

The Weekend's admin/product-intelligence dashboard, at `/admin` — visible only to the site owner (League #1's commissioner; see `ADMIN_SECURITY.md`). This document describes what's built, how the monitoring and alerts work, and what's still deliberately left out.

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
GET /admin/overview | /navigation | /features | /users | /leagues | /engagement | /live | /paths |
    /crashes | /errors | /security | /audit | /badges
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

## What's built

The nav groups every page under **Usage**, **People**, and **Health**. On a phone every section is visible at once (a wrapping grid, not a sideways-scrolling row), and Crashes, Errors, and Security carry red counts for the last 24 hours (`GET /admin/badges`).

### Usage
- **Overview** (`/admin`) — Total/New/Active Users, Total/Active Leagues, Online Now, captioned "Tracking since {date}". Activity Over Time chart, Feature Usage donut, Recent Activity feed, System Health (DB pool, WebSocket connections, scheduled-job freshness), and rule-based Alerts — which now also flag crashes, server errors, app errors, and 10+ failed sign-ins in the last 24 hours.
- **Live** (`/admin/live`) — who has the app open right now and which page each person is on (live connection, or a page view in the last 5 minutes), plus a running feed of the latest 40 events. Refreshes every 10s while visible.
- **Engagement** (`/admin/engagement`) — active people today / this week / this month, stickiness (average daily ÷ monthly), sessions, pages per session, typical session length; a DAU/WAU/MAU chart; a day × hour heat map of when the league is active; Day 1/7/30 retention (with how many people each rate is based on); weekly signup cohorts; an all-time signup funnel (signed up → linked to a team → used the app → came back another day → active this week); and a device/platform breakdown. Days are bucketed in America/Chicago; activity is counted per owner.
- **Navigation** (`/admin/navigation`) — the page heat map, the most common page-to-page moves, where visits start, where they end (with bounces), and Feature Usage.

### People
- **Users** / **User detail** and **Leagues** / **League detail** — unchanged; see `ADMIN_SECURITY.md` for what user detail never shows.

### Health
- **Crashes** (`/admin/crashes`) — pages that died while someone was looking at them (on iPhones, almost always the WebView killed for memory). Detected by `frontend/src/lib/crashReporter.ts`: each page load leaves a beacon in localStorage that's marked clean when the page is hidden or unloaded; a beacon that never got marked clean is reported on the next launch as an `app_crash` event. By page, by device (OS + screen size), and a recent list with the pages leading up to each crash.
- **Errors** (`/admin/errors`) — JavaScript errors from users' devices (`frontend/src/lib/errorReporter.ts`: uncaught errors, unhandled promise rejections, and render errors caught by `app/error.tsx`) and backend errors (any unhandled exception, with traceback, or 5xx response). Grouped by fingerprint (the message with ids, numbers, and quoted values blanked, plus where it happened), so each bug is one row with occurrences, people affected, and first/last seen; "new" marks one first seen in the last 24 hours. Tapping one (`?fp=`) shows every recent occurrence with who hit it, their device, and the stack.
- **Security** (`/admin/security`) — failed sign-ins (with the email tried), blocked (403) requests, rate-limited (429) requests, and bad or reused sign-in links; accounts targeted, busiest IPs, which endpoints turned requests away, and a recent list.
- **Audit Log** (`/admin/audit`) — every successful change made through `/admin/*` (granting/revoking admin, deleting users or teams, syncs, playoff generation, lineup changes), who made it, and when. Read-only.

## Push alerts

Site admins (League #1's commissioner, or `users.is_admin`) get a push on every device they've registered, regardless of quiet hours (`admin_crash`/`admin_error`/`admin_security` are in `quiet_hours._ALWAYS_SEND`). Throttled so a bad game day is a few pings, not dozens — every event is still recorded (`app/notifications/admin_alerts.py`):

| Alert | Fires when | Opens |
|---|---|---|
| 💥 App crash | The first crash on a page in an hour (the body says how many on that page today) | Admin > Crashes |
| 🐞 New error / Error is back | The first occurrence of an error in 6 hours ("new" if it's never been seen) | That error's detail |
| 🛡️ Sign-in attack? | One IP reaches 10 failed sign-ins in 15 minutes, or one account reaches 5 | Admin > Security |

## Monitoring data

Written by `backend/app/monitoring.py` — one outermost middleware plus two direct calls (`record_failed_login` in `POST /auth/login`, and `POST /admin/client-error` for browser errors). Every write runs in a background task and swallows its own failures, so monitoring can never slow down or break the request it watches. Requests from the backend test suite (host `test`) are skipped entirely, since that suite runs against production.

| Table | What's in it |
|---|---|
| `app_errors` | `source` (client/server), `fingerprint`, message, stack, route, method, status, owner/user, platform, OS, screen |
| `security_events` | `kind` (login_failed / forbidden / rate_limited / invalid_token), user, email tried, IP, method, path, user agent |
| `admin_audit_log` | actor, plain-English action (`monitoring.AUDIT_ACTION_LABELS`), method, path, target (path ids plus any `request.state.audit_detail`), status |

The visitor's real IP and user agent reach the backend because the frontend's `/api/backend` proxy forwards `x-forwarded-for` and `user-agent`; `monitoring.client_ip` reads the first `x-forwarded-for` entry. New admin endpoints are audited automatically — add a label to `AUDIT_ACTION_LABELS` so the log reads well.

Crashes are `app_crash` analytics events (`ANALYTICS_EVENTS.md`), not a table of their own — they ride `analytics_events` with no schema change and are excluded from Feature Usage.

## Still not built

| Feature | Why not yet |
|---|---|
| Role hierarchy (Owner/Admin/Support/Analyst/Moderator) | Deliberately deferred — `is_admin` is a sufficient boundary until more roles are actually needed. |
| Click-level tracking | Deliberately never planned — see `ANALYTICS_EVENTS.md`. |
| Marking an error or crash "resolved" | The lists sort by most recent, and a fixed bug simply stops appearing; worth adding if the lists get long. |
| Data retention / pruning for the monitoring tables | Tiny at this league's size; add a scheduled prune if `app_errors` or `security_events` ever grow large. |
| Offline/PWA event queuing | A real edge case at this league's size; not worth the complexity yet. |

## Extending the taxonomy

Adding a new `feature` event: add it to `FEATURE_EVENTS` in **both** `backend/app/analytics/taxonomy.py` and `frontend/src/lib/analyticsEvents.ts`, document it in `ANALYTICS_EVENTS.md`, and add a `track*` helper in `analyticsEvents.ts` for the real call site. The backend independently rejects anything not listed in its own copy, regardless of what the frontend sends — the two files are meant to agree, but the backend is what's actually trusted.

Adding a new route to the nav taxonomy: add a prefix entry to `_ROUTE_PREFIXES` in both taxonomy files (and the migration's one-time SQL mirror, if a historical backfill matters), plus a label in `frontend/src/lib/analyticsEvents.ts`'s `EVENT_LABELS`.
