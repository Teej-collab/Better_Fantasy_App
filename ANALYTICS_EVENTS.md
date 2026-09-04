# Analytics Events

The Weekend's one analytics taxonomy, kept in lockstep across three places:

- `backend/app/analytics/taxonomy.py` — authoritative. `POST /admin/track` rejects any event that doesn't match this exactly.
- `frontend/src/lib/analyticsEvents.ts` — the frontend's copy, used to decide what a `trackEvent` call actually sends.
- This document — the human-readable version of both.

If you add an event, update all three in the same change. An event name or metadata key that doesn't appear here gets rejected by the backend, not silently accepted — see `ADMIN_SECURITY.md` for why that's deliberate.

## Two event types (Phase 1)

**`page_view`** — one per real route, classified automatically from the URL (`classify_route` in both taxonomy files) rather than hand-instrumented per page. This is what backs the navigation heat map.

**`feature`** — a small, deliberately curated set of real product interactions. This is **not** a general click logger. Every button, card, and link in the app could theoretically fire an event; almost none of them should. An event only belongs here if it answers a specific product question someone will actually look at. A wall of `button_clicked` events with no context is worse than not tracking clicks at all — it's the "invasive surveillance" the spec that kicked this off explicitly warned against, just as much as it's noise nobody reads.

## `page_view` events

One per route prefix, matched longest-prefix-first:

| Event name | Route(s) |
|---|---|
| `nav_home` | `/` |
| `nav_seasons` | `/seasons/*` (awards, all-time, weekly) |
| `nav_standings` | `/standings` |
| `nav_matchups` | `/matchups`, `/matchups/*` |
| `nav_gamecast` | `/gamecast`, `/gamecast/*` |
| `nav_history` | `/history` |
| `nav_rivalries` | `/rivalries` |
| `nav_rules` | `/rules` |
| `nav_power_rankings` | `/power-rankings` |
| `nav_draft` | `/draft` |
| `nav_keepers` | `/keepers` |
| `nav_free_agents` | `/free-agents` |
| `nav_trades` | `/trades` |
| `nav_teams` | `/teams/*` (someone else's team) |
| `nav_team` | `/team` (your own) |
| `nav_players` | `/players` |
| `nav_leagues` | `/leagues` |
| `nav_league` | `/league` |
| `nav_chat` | `/chat` |
| `nav_chug` | `/chug` |
| `nav_owners` | `/owners/*` |
| `nav_settings` | `/settings` |
| `nav_commissioner` | `/commissioner`, `/commissioner/*` |
| `nav_admin` | `/admin`, `/admin/*` |
| `nav_weekend` | `/weekend` |
| `nav_login` | `/login` |
| `nav_other` | anything not matched above — a real route this list hasn't been taught about yet, not a bug |

`nav_other` showing up with real volume in the heat map is the signal to add a new row here, not something to ignore.

## `feature` events

| Event name | Metadata | Fires when |
|---|---|---|
| `league_switched` | `to_league_id: number` | An owner switches their active league (`/leagues`' "Switch to this league") |
| `gamecast_game_selected` | `game_id: string` | A visitor taps into a specific game from the Gamecast hub |

Each event's metadata is an **allowlist**, not a schema hint — `POST /admin/track` rejects the whole event if `metadata` contains a key not listed for that `event_name`, even alongside valid keys.

## Session

`session_id` is a `crypto.randomUUID()` generated once per browser tab, held in `sessionStorage` (not `localStorage`) — a new tab is a new session, matching how "session" reads intuitively for a single visit. It resets on a full reload, not on every route change within the same tab.

## Device/platform

Captured on every event, coarse and cheap (not full user-agent parsing):

- `device_type`: `mobile` (< 640px) / `tablet` (< 1024px) / `desktop` — from `window.innerWidth`.
- `platform`: `ios` / `android` / `web` — from a simple `navigator.userAgent` match.

## Privacy — what's deliberately NOT tracked

- No click-level tracking (see the `feature` events section above).
- No arbitrary metadata — every event's metadata is allowlisted server-side.
- No page views for a signed-out visitor (`owner_id` comes from the session; a request with none is a silent no-op, not an anonymous row).
- No passwords, tokens, session secrets, or full request bodies, ever.

## Data retention

Not yet formalized — Phase 1 keeps every raw event indefinitely (a ~12-person league's total volume is trivial). A real retention policy (raw events → N days, aggregated summaries beyond that) is future work once volume actually matters; see `ADMIN_DASHBOARD.md`'s "Not built yet" section.
