# Native Migration — Phase 1 Backend Native-Readiness Plan

Status: **PLANNING ONLY. No code has been written or modified.** This document is the
implementation plan for Phase 1 of the native migration (see
`docs/NATIVE_MIGRATION_AUDIT.md` for the Phase 0 audit this builds on). It covers three
additive workstreams: native push notifications, native OAuth deep-link completion, and
a platform-aware analytics screen taxonomy. Companion documents:
`docs/NATIVE_PHASE_1_DATABASE.md`, `docs/NATIVE_PHASE_1_API.md`,
`docs/NATIVE_PHASE_1_TEST_PLAN.md`.

---

## 1. Executive summary

All three workstreams are additive to the existing FastAPI backend — no existing table,
route, cookie behavior, or web OAuth flow is modified. The backend was already partly
built with a future native client in mind (Bearer-token auth, a reusable short-lived
"ticket" token mechanism, an owner-scoped push-subscription model), which keeps all
three designs smaller than they might otherwise be:

- **Push**: add one new table (`native_push_tokens`) and fan out inside the existing
  `dispatcher.py` module, so every feature that already sends notifications (chug
  events, draft events, fantasy events) gets native delivery for free with **zero
  changes to those call sites**.
- **OAuth**: no new redirect URIs need registering with Discord/Google. Add a `client`
  query param to the existing login-kickoff routes, thread it through the existing
  CSRF `state` cookie mechanism, and reuse the existing ticket-token pattern (already
  used for WebSocket/upload auth) to hand a native app a one-time code instead of a
  long-lived token sitting in a URL.
- **Analytics**: a genuine correction to the Phase 0 audit's assumption — **platform
  tracking (web/ios/android) already exists end-to-end** (DB column, request field,
  validation, and frontend detection). The real remaining work is narrower than
  originally scoped: improve platform-detection fidelity for the existing Capacitor
  WebView wrapper, and add a small screen-name taxonomy for the future case of a truly
  native (non-WebView) screen that has no URL route to auto-classify from.

Nothing in this plan requires creating an Expo project, installing React Native
dependencies, or touching frontend UI — consistent with the phase's scope.

## 2. Current-state architecture (as relevant to these three workstreams)

- **Identity model**: `users` (login identity, `users.id`) and `owners` (fantasy-league
  identity, `owners.owner_id`, linked via nullable `owners.user_id`). A user can be
  signed in with no `owner_id` yet (before joining/creating a league) —
  `resolve_owner_id()` (`backend/app/auth/league_context.py:19-36`) returns `None` in
  that case. Push subscriptions, native device tokens, and analytics events are all
  keyed to `owner_id`, not `user_id`.
- **Session/auth**: HS256 JWT (`backend/app/auth/session.py`), 30-day expiry,
  `token_version`-based server-side revocation. `get_session_token()`
  (`session.py:105-123`) already checks `Authorization: Bearer <token>` before falling
  back to the cookie — built explicitly for native clients. A separate short-lived
  **ticket token** mechanism (`create_ticket_token`/`decode_ticket_token`,
  `session.py:90-138`, `TICKET_MAX_AGE_SECONDS = 60`, `TICKET_PURPOSES` in
  `routers/auth.py:416`) already exists for WebSocket handshakes and chug-video upload
  auth — both new designs below reuse this mechanism rather than inventing a new one.
- **Push (current)**: `push_subscriptions` table (Web Push/VAPID, keyed to `owner_id` +
  unique `endpoint`), dispatched via `backend/app/notifications/dispatcher.py`'s
  `send_to_subscription`/`send_to_owner`/`send_to_owners`. Every feature module
  (`chug_events.py`, `draft_events.py`, `fantasy_events.py`) already calls only these
  three functions — no feature module talks to `pywebpush` or the subscriptions table
  directly.
- **OAuth (current)**: Discord and Google OAuth (`backend/app/routers/auth.py:44-181`)
  both use a cookie-based double-submit `state` for CSRF, exchange the authorization
  code server-side only, and hand the resulting session token to the browser via a
  `#token=...` URL fragment landing on `frontend/src/app/auth/complete/page.tsx` — a
  mechanism deliberately chosen because URL fragments are never sent to any server or
  logged.
- **Analytics (current)**: `analytics_events` table already has a nullable `platform`
  column (`ios`/`android`/`web`, enforced in Python via `ALLOWED_PLATFORMS` in
  `backend/app/analytics/taxonomy.py`, not a DB constraint), already populated by the
  frontend's `detectPlatform()` (UA-sniffing) on every event. `page_view` events are
  auto-classified from the URL route; a small curated `feature` event allowlist covers
  everything else. The existing "native" iOS/Android apps are Capacitor WebView shells
  around the live site (`frontend/capacitor.config.ts`), so today the exact same
  JavaScript — including this analytics code — runs unmodified on web, iOS, and
  Android; there is currently no in-app screen without a URL.

## 3. Workstream 1 — Native push notifications (detailed design)

**Goal**: add APNs (iOS) and FCM (Android) delivery, additive to the existing VAPID web
push, without duplicating notification business logic in any feature module.

**New table**: `native_push_tokens` — see `docs/NATIVE_PHASE_1_DATABASE.md` for the
full schema. Mirrors `push_subscriptions`' conventions: owner-scoped, soft-deleted
(`active` boolean) rather than hard-deleted, tracks per-row delivery success/failure
timestamps. Two unique constraints handle the two real-world reassignment cases: `(owner_id, device_id)` is the upsert target for **token rotation** (same device
re-registers with a new token on app-foreground or OS token refresh — one row, updated
in place) and for **multiple devices per owner** (phone + tablet = two rows); a
separate unique constraint on `push_token` alone catches the case where the OS hands an
identical opaque token to a reinstalled app under a *different* account (mirroring
`push_subscriptions.endpoint`'s existing uniqueness reasoning).

**Dispatch fan-out, not a new caller-facing API**: because every feature module already
routes exclusively through `dispatcher.send_to_owner`/`send_to_owners`, native delivery
is added *inside* `dispatcher.py` only. Each of those two public functions gains a
second, independent fan-out (query `native_push_tokens` for the owner's active
registrations, dispatch to each) alongside the existing VAPID fan-out — same function
signatures, same call sites, zero changes required in `chug_events.py`,
`draft_events.py`, `fantasy_events.py`, or `push.py`'s `/test` route. A push failure on
one channel (e.g. an expired APNs token) must not affect delivery on another channel for
the same event, matching the module's existing "never let a delivery failure interrupt
the caller" discipline.

**Provider libraries**:
- **APNs → `aioapns`** (new dependency). Recommended over hand-rolling raw HTTP/2 via
  `httpx` because APNs' provider-token auth (ES256-signed JWT, refreshed ~hourly, reused
  across a persistent multiplexed HTTP/2 connection) is real protocol/connection
  lifecycle complexity worth a purpose-built async library for, not a single POST.
- **FCM → direct `httpx` calls to FCM's HTTP v1 API** (no new HTTP dependency; `httpx`
  is already installed), with `cryptography` (new dependency) added for RS256 signing
  of the OAuth2 service-account JWT FCM v1 requires. `firebase-admin` was considered and
  rejected: it's synchronous-first, pulls in a heavy `grpcio`/`protobuf` dependency
  chain, and would need the same async-wrapping the direct approach already requires
  with no architectural benefit.

**Invalid/expired token cleanup**: mirrors the existing VAPID pattern
(`_PERMANENT_FAILURE_STATUS = {404, 410}` → `mark_delivery_failed(permanent=True)`).
APNs' `BadDeviceToken`/`Unregistered`/`DeviceTokenNotForTopic` reason strings and FCM's
`UNREGISTERED`/`INVALID_ARGUMENT` error statuses are treated as permanent (row marked
`active = FALSE`); transient errors (rate limits, 5xx, network failures) only update
`last_failure_at`, leaving the row active for retry on the next event.

**New routes**: `POST /push/native/register`, `DELETE /push/native/register/{device_id}` — see `docs/NATIVE_PHASE_1_API.md`. Both use the existing `_require_session`
helper (cookie-or-Bearer, identical to `/push/subscribe` today) — no new auth mechanism.

**Pre-existing gap noted, not fixed by this workstream**: `app/notifications/events.py`
— a dedup/preference/rate-limit pipeline referenced in `dispatcher.py`'s own docstring —
does not exist yet; preference-gating is currently duplicated per feature module. This
workstream's dispatcher-level fan-out sidesteps needing that module to exist, but it
remains a separate, pre-existing gap worth its own future cleanup, out of scope here.

## 4. Workstream 2 — Native OAuth deep-link completion (detailed design)

**Goal**: let a native app complete Discord/Google OAuth and end up with a stored
session token, without assuming a shared browser cookie jar with the web app, and
without registering any new provider-side redirect URI.

**Kickoff**: add an optional `client` query param (`"web"` default, `"native"`
alternative) to the existing `/auth/discord/login` and `/auth/google/login` routes.
Every existing caller (the web app never passes this param) is byte-for-byte unchanged.

**Threading client type through the existing CSRF mechanism, no new signing infra**:
prefix the existing random `state` value with the client type (e.g.
`"native:<random>"`). This needs no new signing scheme because the existing
cookie-based double-submit check already makes `state` tamper-evident — an attacker
cannot forge a different `client_type` prefix without also matching the `oauth_state`
cookie the backend itself set, which only the backend controls.

**Native's browser context**: the native app opens the *same* backend authorization URL
in a real in-app browser session (`ASWebAuthenticationSession` on iOS, Chrome Custom
Tabs on Android — or `expo-auth-session`, which wraps both) — never an embedded
WebView, which providers explicitly discourage/block for OAuth. Because this is a real
browser session against the backend's own domain, the existing `oauth_state` cookie
round-trips exactly as it does today; **no change to the CSRF check itself is needed.**

**Callback redirect target**: the callback parses `client_type` off the validated
`state` and branches only the *final* redirect. `client_type == "web"` is byte-for-byte
today's behavior (`#token=` fragment to `/auth/complete`). `client_type == "native"`
redirects to a universal link / Android App Link (a domain-verified deep link,
preferred over a bare custom URL scheme because custom schemes can be claimed by more
than one installed app — a documented squatting risk universal links avoid via
domain-ownership proof files). A custom-scheme redirect is kept as a same-page
JavaScript fallback for devices where App Link association isn't configured.

**No new provider-side redirect URI**: Discord/Google only ever redirect back to the
backend's own existing callback URL, identically for web and native — the
universal-link hop happens entirely backend→client, after the provider is out of the
picture. This meaningfully reduces the risk surface of this workstream.

**Token delivery — one-time-code exchange, recommended over a bare token in the deep
link**: reuse the existing ticket-token mechanism almost verbatim. Add a new ticket
purpose (e.g. `"native_oauth"`) to `TICKET_PURPOSES`; the native branch of the callback
mints a **ticket** (60-second lifetime, matching the existing `TICKET_MAX_AGE_SECONDS`),
not the real 30-day session token, and puts *that* in the deep link. A new endpoint,
`POST /auth/native/redeem`, exchanges the ticket for the real session JWT via a direct
POST response body (never a URL) — the native app stores this the same way it would
store a token from `/auth/login`. Rationale: a 30-day token sitting in a deep-link URL
is exposed to OS-level surfaces (Android `logcat`/app-link resolution logs, browser
history, iOS Spotlight suggestions) that aren't worth protecting against for a 60-second
value but matter for a 30-day one.

**Security summary** (full detail in §8 and `NATIVE_PHASE_1_API.md`): CSRF/state
generalizes without new mechanism; authorization-code exchange stays server-side only
(unchanged); no open-redirect surface is introduced (redirect target is chosen from a
CSRF-protected constant, not user input); replay risk on the new ticket purpose is
bounded to a 60-second window (an optional future hardening — single-use ticket
tracking — is noted but not required for this phase); logout and cancellation behavior
are both unchanged (cancellation is handled entirely by the OS-native browser session,
no backend request is ever made).

## 5. Workstream 3 — Analytics screen taxonomy (detailed design)

**Correction to the original scoping**: platform tracking is not new work — it already
exists end-to-end (`analytics_events.platform` column, `TrackEventRequest.platform`
field, `ALLOWED_PLATFORMS = {"ios","android","web"}` validation, and frontend
`detectPlatform()` populating it on every event today). The remaining work is narrower:

**(a) Platform-detection fidelity (no schema change)**: today's `detectPlatform()` uses
a `navigator.userAgent` regex, which already works correctly inside the existing
Capacitor WebView (the OS-injected UA string still identifies the underlying OS).
Improve it to prefer `Capacitor.isNativePlatform()`/`Capacitor.getPlatform()` (from the
already-installed `@capacitor/core`) when running inside the Capacitor runtime, falling
back to the UA regex otherwise — a value-quality improvement, not a taxonomy or schema
change. `ALLOWED_PLATFORMS` and the DB column are untouched.

**(b) Screen-identifier taxonomy for routeless screens (additive)**: add a curated
`SCREEN_NAMES` set to `taxonomy.py`, derived directly from the real route inventory
(collapsing dynamic segments like `[matchupId]` into one canonical name each — see the
full list in `docs/NATIVE_PHASE_1_API.md`). Extend `validate_event()`'s `page_view`
branch to two cases: `route` present → unchanged, validate against the existing
`NAV_EVENT_NAMES` exactly as today; `route is None` and `platform` is `ios`/`android` →
validate against the new `SCREEN_NAMES` instead, with `platform` required (not
defaulted) since a routeless event with no platform isn't a meaningful case. A new
frontend/native helper, `trackScreenView(screenName, platform)`, sends `event_type:
"page_view"`, the screen name, `route: null`. This is purely additive — no existing
valid request becomes invalid, and web's route-based auto-classification code is not
touched at all. It exists for the future case of a true native (non-WebView) screen;
today's Capacitor-wrapped app has no such screen yet.

**Backward compatibility**: total. The web client already sends `platform`; any caller
that omits it hits an existing, already-handled `None` path (`validate_event` already
treats `platform: None` as valid).

**Privacy**: `platform` is a coarse OS bucket, not personally identifying (same
reasoning already applied to the adjacent `device_type` field). No change to identity
handling — `owner_id` is resolved server-side from the session, never client-supplied,
for both existing and new event types.

## 6. Database changes

Full detail in `docs/NATIVE_PHASE_1_DATABASE.md`. Summary:

- **New table**: `native_push_tokens` (Workstream 1). One new Alembic migration.
- **No schema change** for Workstream 2 (OAuth) — reuses the existing ticket-token
  mechanism, which is stateless (signed JWT, no DB row).
- **No schema change** for Workstream 3 (Analytics) — `platform` and `route` (nullable)
  already exist on `analytics_events`; `SCREEN_NAMES` is a Python-level allowlist
  addition in `taxonomy.py`, matching this table's existing convention of enforcing
  `event_name`/`platform` values in code rather than via DB CHECK constraints.

## 7. API changes

Full detail in `docs/NATIVE_PHASE_1_API.md`. Summary:

- **New**: `POST /push/native/register`, `DELETE /push/native/register/{device_id}`
  (Workstream 1); `POST /auth/native/redeem` (Workstream 2); a `client` query param
  added to `GET /auth/discord/login` and `GET /auth/google/login` (Workstream 2,
  optional, defaults preserve current behavior).
- **Modified (additive only)**: `dispatcher.py`'s internal fan-out (not a public API
  change); the Discord/Google OAuth callback routes gain a native branch but keep their
  existing behavior byte-for-byte for `client=web`/omitted; `POST /admin/track`'s
  existing `platform` field gains a new valid combination (`route: null` +
  `SCREEN_NAMES` value) alongside its existing valid shapes.
- **Unmodified**: `POST /push/subscribe`, `POST /push/unsubscribe`, `POST /push/test`,
  `GET /push/vapid-public-key`, `/auth/login`, `/auth/signup`, `/auth/logout`,
  `/auth/me`, `/auth/ticket`.

## 8. Security considerations

- **Provider secrets**: APNs `.p8` key and FCM service-account JSON must be loaded
  server-side only, following the codebase's existing `_require()`-style fail-loud env
  var convention (used for ESPN/LiveKit/Sportradar/Anthropic keys today) — never bundled
  into the native app itself.
- **OAuth CSRF**: unchanged mechanism (cookie double-submit), generalized (not
  weakened) by carrying `client_type` as a prefix inside the already-protected `state`
  value.
- **OAuth token exposure**: mitigated by the one-time-ticket-exchange design (§4) rather
  than placing a long-lived token in a deep link URL.
- **OAuth replay**: bounded to the ticket's 60-second window; single-use enforcement is
  flagged as an optional future hardening, not a blocking requirement for this phase (no
  existing ticket purpose in this codebase enforces single-use today either — this
  keeps the new purpose consistent with existing practice rather than introducing an
  inconsistent stricter standard for only one ticket type).
- **Push token validation**: invalid/expired tokens are only ever discovered via
  provider response codes at send time (never trusted from client input beyond initial
  registration), consistent with how `push_subscriptions` handles VAPID failures today.
- **Analytics identity**: unaffected — `owner_id` remains server-derived from the
  session for every event, never client-supplied, for both existing and new event
  shapes.
- **No changes** to cookie domain/SameSite/Secure logic, `session_revocation`
  middleware, or CORS configuration — all three are explicitly out of scope and are not
  touched by any file in the implementation plan below.

## 9. Backwards compatibility considerations

Every change in this plan is additive:
- Push: a new table and new routes; existing VAPID table, routes, and dispatch path
  untouched; existing feature-module call sites require zero changes.
- OAuth: a new optional query param (safe default), a new ticket purpose, a new
  redemption route; the existing web OAuth path is unchanged for any request that omits
  `client` or passes `client=web`.
- Analytics: `platform`/`route` are already nullable/optional; the new `SCREEN_NAMES`
  validation path only activates when `route` is `null`, a shape the existing web
  client never sends — zero risk of an existing valid web request becoming invalid.

## 10. Migration/rollback strategy

- **Database**: one new additive Alembic migration (`native_push_tokens`), reversible
  via a standard `DROP TABLE` in `downgrade()`, matching this repo's existing migration
  style. No existing table is altered, so rollback carries zero risk to existing data.
- **Push dispatch**: the native fan-out inside `dispatcher.py` should be gated so that a
  misconfigured or absent APNs/FCM credential set degrades to "skip native delivery,
  log, continue" rather than raising — mirroring how the codebase already treats
  optional integrations (e.g. LiveKit's `require_livekit_configured` gate, Sportradar's
  key-absent fallback to a mock provider). This means Phase 1 can be deployed with the
  new code paths present but inert until APNs/FCM credentials are actually configured,
  giving a natural, low-risk rollout: deploy code → verify web push still works
  identically → configure native credentials → verify native push separately.
- **OAuth**: the new native branch only activates when `client=native` is explicitly
  passed by a caller — since no native client exists yet, this code path cannot be
  exercised in production until a native app starts calling it, making this the
  lowest-risk of the three workstreams to deploy ahead of any client using it.
- **Analytics**: the new `SCREEN_NAMES` validation branch only activates for
  `route: null` events, which no existing client sends — same "deployed but inert until
  used" property.
- **Rollback**: each workstream can be reverted independently (they touch disjoint
  files/tables) by reverting its migration (push) and/or its code changes; none of the
  three has a dependency on the others being present.

## 11. Testing strategy

Full test plan in `docs/NATIVE_PHASE_1_TEST_PLAN.md`. Summary of approach: extend the
existing pytest suite (89 files today, `backend/tests/`) with new test modules
per-workstream, following existing conventions (`conftest.py` fixtures,
`fakes_espn.py`-style fakes for the new APNs/FCM HTTP calls). Every existing push/auth/
analytics test must continue passing unmodified — these are the concrete backward-
compatibility check, not just a stated intention.

## 12. Exact file-by-file implementation plan

**Workstream 1 — Push**
- `backend/migrations/versions/<new>_add_native_push_tokens_table.py` — new migration,
  create `native_push_tokens` (see `NATIVE_PHASE_1_DATABASE.md`).
- `backend/app/queries/native_push_tokens.py` — new file. Functions:
  `upsert_registration`, `deactivate_registration`,
  `list_active_registrations_for_owner`, `list_active_registrations_for_owners`,
  `mark_delivery_success`, `mark_delivery_failed`, `has_any_active_registration` (for
  the combined-channel `push_enabled` check).
- `backend/app/notifications/apns_client.py` — new file. Thin `aioapns`-based sender:
  connection/provider-token setup, `send_apns(token, payload) -> (delivered, reason)`.
- `backend/app/notifications/fcm_client.py` — new file. `httpx`-based FCM v1 sender:
  OAuth2 access-token minting/caching (RS256 JWT via `cryptography`), `send_fcm(token,
  payload) -> (delivered, status)`.
- `backend/app/notifications/dispatcher.py` — modified. Add `_send_apns_one`,
  `_send_fcm_one`, `send_to_native_registration`; extend `send_to_owner`/
  `send_to_owners` to also fan out to `native_push_tokens`. Existing `_send_one`/
  `send_to_subscription` untouched.
- `backend/app/routers/push.py` — modified. Add `POST /push/native/register`,
  `DELETE /push/native/register/{device_id}`; extend the existing "flip `push_enabled`
  off" check (currently only queries `push_subscriptions`) to also check
  `native_push_tokens` via the new `has_any_active_registration` helper.
- `backend/app/auth/config.py` (or a new `backend/app/notifications/native_push_config.py`) — add lazy-loaded config for `APNS_KEY_ID`, `APNS_TEAM_ID`,
  `APNS_BUNDLE_ID`, `APNS_KEY_PATH`/`APNS_KEY_CONTENT`, `FCM_SERVICE_ACCOUNT_JSON` (or
  path), following the existing `_require()` fail-loud-if-used pattern.
- `backend/.env.example` — add the new env var names (values placeholder-only).
- `backend/requirements.txt` — add `aioapns`, `cryptography`.

**Workstream 2 — OAuth**
- `backend/app/routers/auth.py` — modified. Add `client` query param to
  `discord_login`/`google_login`; prefix `state` with `client_type`; branch the
  callback's final redirect on the parsed `client_type`; add error-case native deep-link
  redirects. Add new route `POST /auth/native/redeem`.
- `backend/app/auth/session.py` — modified (minimal). Add `"native_oauth"` to
  `TICKET_PURPOSES` (or wherever that set is defined — confirmed at
  `routers/auth.py:416` in the design agent's reading; verify exact location during
  implementation).
- `backend/.env.example` — add `NATIVE_APP_UNIVERSAL_LINK_BASE` (or equivalent) and
  `NATIVE_APP_CUSTOM_SCHEME` for the deep-link redirect targets.
- `frontend/public/.well-known/apple-app-site-association` — new static file (no
  extension, served with `application/json` content type) for iOS Universal Links
  domain verification.
- `frontend/public/.well-known/assetlinks.json` — new static file for Android App
  Links domain verification.
- `frontend/src/app/auth/native-complete/page.tsx` — new, lightweight fallback page
  ("Return to the app to finish signing in" + manual custom-scheme retry button) for
  the case where OS-level app-link interception doesn't fire.

**Workstream 3 — Analytics**
- `backend/app/analytics/taxonomy.py` — modified. Add `SCREEN_NAMES` set (see full list
  in `NATIVE_PHASE_1_API.md`); extend `validate_event()`'s `page_view` branch to accept
  either `(route present, NAV_EVENT_NAMES)` or `(route is None, platform required,
  SCREEN_NAMES)`.
- `frontend/src/lib/analyticsEvents.ts` — modified. Improve `detectPlatform()` to prefer
  `Capacitor.isNativePlatform()`/`getPlatform()`; add `trackScreenView(screenName,
  platform)` helper alongside the existing `trackPageView`/`trackFeature`.
- `ANALYTICS_EVENTS.md` — modified. Document the new `SCREEN_NAMES` taxonomy and the
  `trackScreenView` contract, matching this doc's existing structure.

**Tests** (see `NATIVE_PHASE_1_TEST_PLAN.md` for full list): new files under
`backend/tests/` — `test_native_push_registration.py`, `test_native_push_dispatch.py`,
`test_native_oauth.py`, `test_analytics_screen_taxonomy.py` — plus additions to any
existing `test_push_*.py`/`test_auth_*.py`/`test_analytics_*.py` files to assert
existing behavior is unchanged.

## 13. Dependencies that would need to be added

| Dependency | Purpose | Workstream |
|---|---|---|
| `aioapns` | Async APNs client (provider-token auth, HTTP/2 connection management) | 1 |
| `cryptography` | RS256 signing for FCM v1's OAuth2 service-account JWT | 1 |

No new dependencies are required for Workstreams 2 or 3 — both reuse existing
libraries (`pyjwt` for tickets, `httpx` already present, `@capacitor/core` already a
frontend dependency).

## 14. Environment variables/secrets required

| Variable | Purpose | Workstream |
|---|---|---|
| `APNS_KEY_ID` | Apple-issued key ID for the `.p8` provider-auth key | 1 |
| `APNS_TEAM_ID` | Apple Developer team ID | 1 |
| `APNS_BUNDLE_ID` | iOS app bundle identifier (APNs topic) | 1 |
| `APNS_KEY_PATH` or `APNS_KEY_CONTENT` | The `.p8` private key itself (file path or inline content, matching this repo's existing secret-handling conventions) | 1 |
| `FCM_SERVICE_ACCOUNT_JSON` (or `FCM_SERVICE_ACCOUNT_JSON_PATH`) | Google service-account credentials for FCM v1 OAuth2 | 1 |
| `NATIVE_APP_UNIVERSAL_LINK_BASE` | Domain/path the OAuth callback redirects to for native clients | 2 |
| `NATIVE_APP_CUSTOM_SCHEME` | Fallback custom URL scheme (e.g. `weekendleague://`) | 2 |

No new environment variables are required for Workstream 3.

## 15. Deployment considerations

- Both native push credentials (APNs, FCM) and the native OAuth redirect targets are
  **inert until a native client exists to use them** (per §10's rollback strategy) —
  this backend work can be deployed to production well ahead of any native app release
  with no behavior change for existing web users.
- The `.well-known/apple-app-site-association` and `assetlinks.json` files must be
  served over HTTPS with no redirects and the exact content types Apple/Google expect;
  this is a frontend/Vercel static-file concern, not a backend deployment concern, but
  should be verified before the native app build attempts to use Universal Links/App
  Links (an unverified association silently falls back to the custom-scheme path, per
  the design in §4 — not a hard failure, but worth catching in testing rather than
  discovering in production).
- APNs requires app-store-review-adjacent setup (the `.p8` key and bundle ID come from
  an Apple Developer account tied to the native app's own App Store Connect record,
  which doesn't exist yet) — this credential can realistically only be finalized once
  the native app project itself is registered with Apple, i.e. during a later phase, not
  necessarily blocking Phase 1's code from merging.

## 16. Open questions

1. **Ticket single-use enforcement**: should the new `native_oauth` ticket purpose (or
   all ticket purposes) get single-use tracking (a small redeemed-ticket table), closing
   the theoretical replay-within-60-seconds window? Flagged as optional in this plan;
   worth an explicit decision rather than defaulting silently either way.
2. **APNs/FCM credential provisioning timing**: since APNs credentials depend on the
   native app's own App Store Connect registration (not yet created), should Phase 1's
   code ship now with credentials configured later, or should credential provisioning be
   pulled into this phase's scope regardless of native-app-registration status?
3. **`push_enabled` combined-channel semantics**: confirm the proposed behavior (only
   flip the master toggle off when *zero* active subscriptions remain across *both*
   `push_subscriptions` and `native_push_tokens`) matches product intent — an
   alternative would be per-channel toggles instead of one shared boolean.
4. **Universal Link vs. custom-scheme default**: confirm the preference for Universal
   Links (with custom scheme as fallback) over defaulting to custom scheme outright —
   Universal Links require more upfront setup (domain association files, Apple Developer
   configuration) but close a real app-squatting risk.
5. **Screen taxonomy scope**: since the current native apps are Capacitor WebViews with
   no routeless screens today, is it worth landing `SCREEN_NAMES` now (speculatively,
   ahead of any screen that needs it), or deferring it until an actual native-only
   screen is planned — consistent with this project's general preference (noted in
   `ANALYTICS_EVENTS.md`'s own philosophy) not to add fields/taxonomy before there's a
   real consumer for them?

## 17. Recommended implementation order

1. **Analytics — platform-detection fidelity fix** (§5a): smallest, lowest-risk change,
   improves data quality immediately for the existing Capacitor apps with no schema or
   API change.
2. **Push — schema + query layer**: `native_push_tokens` migration and
   `queries/native_push_tokens.py`, independently testable before any dispatch wiring.
3. **Push — dispatch fan-out + registration routes**: `dispatcher.py` changes,
   `apns_client.py`/`fcm_client.py`, `push.py` routes — the largest single workstream,
   sequenced after its schema dependency.
4. **OAuth — native kickoff + ticket redemption**: lowest production risk (inert until
   a native client calls it), but benefits from push's dispatch work being done first
   only in the trivial sense of keeping PRs reviewably small, not a hard dependency.
5. **Analytics — `SCREEN_NAMES` taxonomy**: last, and only if open question 5 resolves
   toward "land it now" rather than "defer until a real native screen needs it."

Each item above is independently shippable and independently revertible — this order
is a recommendation for sequencing review-sized changes, not a set of hard
dependencies between workstreams.
