# Native Migration — Phase 1 API Changes

Status: **PLANNING ONLY. No endpoint has been implemented or modified.** Companion to
`docs/NATIVE_PHASE_1_PLAN.md`. All authentication below refers to the existing
`_require_session` pattern (`backend/app/routers/push.py`), which already accepts
either the `session` cookie or an `Authorization: Bearer <token>` header via
`get_session_token()` (`backend/app/auth/session.py:105-123`) — no new auth mechanism
is introduced anywhere in this document.

---

## Workstream 1 — Native push

### `POST /push/native/register` (new)

Registers or updates a native device's push token for the authenticated owner.

**Auth**: session required (cookie or Bearer). `owner_id` resolved server-side via
`resolve_owner_id()` — never accepted from the request body.

**Request body**:
```json
{
  "device_id": "string, required — stable per-device identifier",
  "platform": "ios | android, required",
  "push_token": "string, required — APNs device token or FCM registration token",
  "app_version": "string, optional",
  "os_version": "string, optional"
}
```

**Behavior**:
1. Resolve `owner_id` from session; if `None` (signed in, no league yet), return
   `409 Conflict` (mirroring how `/push/subscribe` should already handle this
   pre-existing edge case — verify exact current behavior during implementation rather
   than assuming a specific status code not yet confirmed in the codebase).
2. If an existing row has this `push_token` under a *different* `(owner_id,
   device_id)`, deactivate that row first (handles token reassignment after
   reinstall-under-a-different-account).
3. Upsert on `(owner_id, device_id)`: insert or update `push_token`, `app_version`,
   `os_version`, `platform`, `updated_at`, `last_seen_at`, `active = TRUE`.
4. Set `owner_preferences.push_enabled = TRUE` (mirrors `/push/subscribe`'s existing
   behavior at `push.py:70-74` — native and web registration both drive the same
   master toggle).

**Response** (`200 OK`):
```json
{
  "id": 123,
  "device_id": "string",
  "platform": "ios",
  "active": true
}
```

**Errors**: `401` (no valid session), `409` (no `owner_id` yet — see step 1), `422`
(invalid `platform` value or missing required field, standard FastAPI/Pydantic
validation).

**Native-only behavior**: this endpoint has no web equivalent — it is the native
counterpart to `POST /push/subscribe`, not a modification of it.

**Backwards compatibility**: entirely new route; no interaction with existing routes
beyond the shared `owner_preferences.push_enabled` write, which is the same field
`/push/subscribe` already writes.

---

### `DELETE /push/native/register/{device_id}` (new)

Deactivates one device's native push registration for the authenticated owner
(logout / "disable notifications on this device").

**Auth**: session required (cookie or Bearer).

**Path param**: `device_id` (string).

**Behavior**:
1. Resolve `owner_id` from session.
2. Deactivate the row scoped to `(owner_id, device_id)` — **must** be scoped to both,
   not `device_id` alone, so one owner cannot deactivate another owner's device by
   guessing an ID (mirrors `/push/unsubscribe`'s existing `(owner_id, endpoint)`
   scoping at `push.py:82-96`).
3. If no matching active row exists, return `404`.
4. Re-check whether the owner has *any* remaining active channel — across **both**
   `native_push_tokens` and `push_subscriptions` — and only then flip
   `owner_preferences.push_enabled` to `FALSE`. This is an extension of
   `/push/unsubscribe`'s existing check (currently `push_subscriptions`-only,
   `push.py:90-95`) to a combined-channel check, via a new
   `has_any_active_registration`-style helper.

**Response**: `204 No Content` on success.

**Errors**: `401`, `404` (no matching active registration for this owner/device).

**Native-only behavior**: native counterpart to `POST /push/unsubscribe`.

**Backwards compatibility**: the extended `push_enabled` check must not change
behavior for any existing web-only owner (an owner with zero `native_push_tokens` rows
sees identical behavior to today, since the added check on an empty table is a no-op).

---

### Internal change: `dispatcher.py` fan-out (not a public API change)

`send_to_owner(conn, owner_id, payload)` and `send_to_owners(conn, owner_ids, payload)`
keep their existing signatures and existing callers (`chug_events.py`,
`draft_events.py`, `fantasy_events.py`, `push.py`'s `/test` route) unchanged. Internally,
each function gains a second fan-out — querying `native_push_tokens` for active
registrations and dispatching via new private functions `_send_apns_one`/
`_send_fcm_one` — alongside the existing VAPID fan-out. No caller needs to change. The
`delivered` count returned may now reflect delivery across both channels combined; the
only current consumer of that count (`/push/test`'s response) only checks truthiness/
count for a diagnostic response, not business logic, so this is a safe, additive
widening.

---

## Workstream 2 — Native OAuth

### `GET /auth/discord/login` and `GET /auth/google/login` (modified, additive)

**New query param**: `client` (optional, `"web" | "native"`, default `"web"`).

**Behavior change**: when `client=native`, the generated `state` value is prefixed with
the client type (e.g. `"native:<random>"`) before being set in the `oauth_state`
cookie and included in the provider authorization URL. When `client` is omitted or
`"web"`, behavior is byte-for-byte identical to today (state generation, cookie,
authorization URL construction all unchanged).

**Backwards compatibility**: total — no existing caller passes `client`, so every
existing request path is unaffected.

---

### `GET /auth/discord/callback` and `GET /auth/google/callback` (modified, additive)

**Behavior change**: after validating `state` against the `oauth_state` cookie
(unchanged check), parse the `client_type` prefix from the now-validated `state`
value. Branch only the *final redirect target*:

- `client_type == "web"` (or absent, for any pre-existing in-flight state without a
  prefix — a graceful fallback, not an error): unchanged — dual `Set-Cookie` +
  `{frontend_url}/auth/complete#token={token}` fragment redirect, exactly as today.
- `client_type == "native"`: instead of minting the real session token into a
  fragment, mint a short-lived **ticket** (new purpose `"native_oauth"`, 60-second
  lifetime, matching the existing `TICKET_MAX_AGE_SECONDS`) and redirect to
  `{NATIVE_APP_UNIVERSAL_LINK_BASE}/auth/native-complete?ticket={ticket}` (with a
  custom-scheme fallback link on the same landing page for devices where Universal
  Link/App Link association isn't active). No `Set-Cookie` is issued in this branch —
  a native client has no use for a cookie on the backend's domain.

**Error-case behavior change**: existing error redirects (provider denial, the
Discord-only "not a league member" case at `auth.py:74`) also branch on `client_type`
— native errors redirect to a native error deep link with an error-code query param
instead of the web `/login?error=...` redirect. State-validation failures themselves
(missing/mismatched `state`) remain a generic `400` for both flows, since an
unvalidated `state` cannot be trusted to route anywhere.

**Backwards compatibility**: total for `client_type == "web"`/absent — every existing
in-flight or future web OAuth attempt behaves identically.

---

### `POST /auth/native/redeem` (new)

Exchanges a short-lived native-OAuth ticket (delivered via the deep link above) for a
real session token.

**Auth**: none required (this endpoint *establishes* auth) — security instead relies
entirely on possession of the short-lived, purpose-scoped ticket.

**Request body**:
```json
{
  "ticket": "string, required — the value from the deep link's ?ticket= param"
}
```

**Behavior**:
1. `decode_ticket_token(secret, ticket, purpose="native_oauth")` — validates
   signature, expiry (60s), and purpose. Reject with `401` on any failure (expired,
   wrong purpose, invalid signature).
2. On success, mint and return the real session JWT, in the same JSON shape
   `/auth/login`/`/auth/signup` already return.

**Response** (`200 OK`):
```json
{
  "token": "string — the session JWT, to be stored client-side and sent as Authorization: Bearer on subsequent requests"
}
```

**Errors**: `401` (invalid, expired, or already-inspected-for-wrong-purpose ticket).

**Native-only behavior**: this endpoint has no web equivalent — the web flow never
needs a redemption step, since its token arrives directly in the URL fragment to a
page that already knows how to set a cookie from it.

**Backwards compatibility**: entirely new route, no interaction with any existing
endpoint's behavior.

**Note on replay**: per `NATIVE_PHASE_1_PLAN.md` §16, this ticket is not tracked as
single-use in this initial design (consistent with how other existing ticket purposes
work today) — a ticket intercepted within its 60-second window could theoretically be
redeemed twice. This is flagged as an open question/optional hardening, not resolved
silently.

---

## Workstream 3 — Analytics

### `POST /admin/track` (modified, additive — validation only)

No change to the endpoint's URL, auth, or existing request fields. The existing
`platform` field (`TrackEventRequest.platform: str | None`) and `route` field are
unchanged in shape. What changes is `validate_event()`'s internal logic:

**Before**: `event_type == "page_view"` → `event_name` must be a value produced by
`classify_route()` from `route` (i.e., always paired with a non-null `route` in
practice, since the frontend always calls `trackPageView` with a route).

**After**: `event_type == "page_view"` accepts two shapes:
1. `route` present → unchanged: `event_name` must be one of the existing
   `NAV_EVENT_NAMES`.
2. `route` is `null` **and** `platform` is `"ios"` or `"android"` → `event_name` must
   be one of the new `SCREEN_NAMES` set (below); `platform` is required (not defaulted)
   in this branch, since a routeless event with no platform is not a meaningful
   combination.

**Proposed `SCREEN_NAMES` set** (derived from the actual route inventory; each dynamic
route segment collapses to one canonical name, never one per instance):

```
home, marketing_welcome, marketing_commissioners,
login, forgot_password, reset_password,
leagues_list, league_home,
standings, power_rankings, history, rivalries, rules,
seasons_hub, season_detail, season_awards, season_draft_recap,
draft_room,
matchup_list, matchup_detail,
gamecast_hub, gamecast_game,
team_mine, team_other, players, free_agents, trades, keepers,
chat, chug, activity, owners_list, owner_detail,
commissioner_home, commissioner_league, commissioner_members, commissioner_polls,
commissioner_roster, commissioner_scoring, commissioner_teams, commissioner_trades,
settings, more,
admin_overview, admin_navigation, admin_leagues, admin_league_detail,
admin_users, admin_user_detail,
weekend
```

**New client-side contract** (not a backend route, but part of the API surface a
native client uses): a `trackScreenView(screenName: ScreenName, platform: "ios" |
"android")` helper, analogous to today's `trackPageView`, sends:
```json
{
  "event_type": "page_view",
  "event_name": "<screen name>",
  "route": null,
  "platform": "ios"
}
```
to the same `POST /admin/track` endpoint.

**Backwards compatibility**: total. The existing web client always sends a non-null
`route`, so it always hits branch 1 (unchanged). No existing valid request becomes
invalid; the new branch only accepts requests shaped in a way the current web client
never produces.

**Native-only behavior**: branch 2 is native-only by construction (`route: null` +
`platform` in `{ios, android}`) — today's Capacitor-wrapped "native" apps still run
the same web JavaScript and always have a route, so in practice this branch is unused
until (if) a genuinely native, non-WebView screen is built. Landing this now is a
speculative-readiness decision — see open question 5 in `NATIVE_PHASE_1_PLAN.md`.

---

## Summary table

| Endpoint | Status | Auth | Web behavior affected? |
|---|---|---|---|
| `POST /push/native/register` | New | Session (cookie/Bearer) | No |
| `DELETE /push/native/register/{device_id}` | New | Session (cookie/Bearer) | Only via combined `push_enabled` check, which is a no-op for owners with no native devices |
| `GET /auth/discord/login`, `GET /auth/google/login` | Modified (new optional param, safe default) | None (public) | No — default preserves current behavior |
| `GET /auth/discord/callback`, `GET /auth/google/callback` | Modified (new branch) | None (public) | No — branch only activates for `client_type == "native"`, which no existing flow produces |
| `POST /auth/native/redeem` | New | None (ticket-based) | No |
| `POST /admin/track` | Modified (validation only, no shape change) | Session (existing) | No — new branch only activates for `route: null`, which the web client never sends |
