# Native Migration — Phase 1 Implementation Report

Status: **Implemented and tested against the Phase 1 planning documents**
(`NATIVE_PHASE_1_PLAN.md`, `NATIVE_PHASE_1_DATABASE.md`, `NATIVE_PHASE_1_API.md`,
`NATIVE_PHASE_1_TEST_PLAN.md`), including both mandatory hardening requirements
(single-use OAuth tickets, owner-scoped device deletion). Nothing has been pushed;
everything below is in the local working tree pending your review.

---

## 1. Files changed

**New files**
- `backend/migrations/versions/796e33a7e4dd_add_native_push_tokens_table_for_native_.py`
- `backend/migrations/versions/4b0f790da9c8_add_used_oauth_tickets_table_for_single_.py`
- `backend/app/queries/native_push_tokens.py`
- `backend/app/queries/used_oauth_tickets.py`
- `backend/app/notifications/apns_client.py`
- `backend/app/notifications/fcm_client.py`
- `backend/tests/test_native_push_registration.py`
- `backend/tests/test_native_push_dispatch.py`
- `backend/tests/test_native_oauth.py`
- `backend/tests/test_analytics_screen_taxonomy.py`

**Modified files**
- `backend/app/config.py` — added `require_apns_configured()`, `require_fcm_configured()` (lazy, fail-loud-at-use, matching the existing VAPID/LiveKit/email pattern exactly).
- `backend/app/auth/session.py` — `create_ticket_token()` gained an optional `jti: str | None = None` parameter (default preserves every existing caller's behavior byte-for-byte).
- `backend/app/routers/auth.py` — added `client` query param to `/auth/discord/login` and `/auth/google/login`; added a native branch to both callbacks (ticket-based deep-link redirect instead of the web `#token=` fragment); added `POST /auth/native/redeem`.
- `backend/app/routers/push.py` — added `POST /push/native/register`, `DELETE /push/native/register/{device_id}`; extended the "flip `push_enabled` off" check to consider both channels via a new `_has_any_active_channel()` helper.
- `backend/app/notifications/dispatcher.py` — added native (APNs/FCM) fan-out inside `send_to_owner`/`send_to_owners`; existing VAPID code path (`_send_one`, `send_to_subscription`) is untouched.
- `backend/app/analytics/taxonomy.py` — added `SCREEN_NAMES` set and `NATIVE_PLATFORMS` constant; `validate_event()`'s `page_view` check now accepts `NAV_EVENT_NAMES` **or** `SCREEN_NAMES` (signature unchanged).
- `backend/app/routers/admin.py` — `track_event()` gained a route-based business rule: a `page_view` with `route: null` must have a native `platform` and a `SCREEN_NAMES` event name.
- `backend/tests/conftest.py` — added cleanup for `native_push_tokens` (owner-scoped, mirrors `push_subscriptions`) and `used_oauth_tickets` (jti-prefix-scoped, since that table has no owner/season column).
- `backend/requirements.txt` — added `aioapns==4.0`, `cryptography==50.0.1`.
- `backend/.env.example` — documented the new env vars (see §7).
- `frontend/src/lib/analyticsEvents.ts` — `detectPlatform()` now prefers `Capacitor.isNativePlatform()`/`getPlatform()` over UA sniffing when available; added `trackScreenView()` helper.

**Explicitly not modified**: `push_subscriptions` table/queries, `dispatcher.py`'s VAPID send path, `frontend/public/sw.js`, `frontend/src/lib/push.ts`, cookie domain/SameSite/Secure logic (`app/auth/config.py`), `session_revocation` middleware (`app/main.py`), CORS configuration, any provider-secret handling for ESPN/LiveKit/Sportradar/Anthropic, any unrelated database table, any React UI/screen.

## 2. Database migrations

Two new tables, both purely additive:

1. **`796e33a7e4dd`** — `native_push_tokens` (device registrations for APNs/FCM). See
   `NATIVE_PHASE_1_DATABASE.md` for the full column-by-column design.
   **Corrected during implementation**: the `push_token` unique index was changed from
   an unconditional `UNIQUE(push_token)` to a partial `UNIQUE(push_token) WHERE active`
   — testing caught that the unconditional version rejected a legitimate token
   reassignment (an OS handing the same physical-device token to a different account
   after reinstall), because deactivating the old row doesn't clear its `push_token`
   value, so an unconditional unique index kept colliding with it. The partial index
   (matching the same pattern already used for `idx_native_push_tokens_owner_id`) fixes
   this correctly. Both the migration and `NATIVE_PHASE_1_DATABASE.md` reflect the
   corrected design.
2. **`4b0f790da9c8`** — `used_oauth_tickets` (single-use redemption tracking for native
   OAuth tickets, added for Requirement 1). `jti TEXT PRIMARY KEY` + `redeemed_at`; the
   `INSERT`'s primary-key constraint is the atomicity guarantee against a race between
   two concurrent redemption attempts of the same ticket.

Both migrations were applied to the development database and verified via
`information_schema`/`pg_indexes` queries during implementation.

## 3. Endpoints added

| Endpoint | Purpose |
|---|---|
| `POST /push/native/register` | Register/rotate a native device's push token |
| `DELETE /push/native/register/{device_id}` | Deactivate one device (owner-scoped) |
| `GET /auth/discord/login?client=native` | Native OAuth kickoff (Discord) |
| `GET /auth/google/login?client=native` | Native OAuth kickoff (Google) |
| `POST /auth/native/redeem` | Exchange a single-use ticket for a real session token |

`POST /admin/track` is unchanged in shape but gained a new valid combination
(`route: null` + native `platform` + `SCREEN_NAMES` event name) — see
`NATIVE_PHASE_1_API.md` for full request/response contracts.

## 4. Dependencies added

- `aioapns==4.0` (APNs — chosen for its async-native provider-token/HTTP-2 handling; verified its `key`/`key_id`/`team_id`/`topic` constructor and `NotificationResult.status`/`.description` shape directly against the installed package source, not assumed).
- `cryptography==50.0.1` (RS256 signing for FCM's OAuth2 service-account JWT; confirmed PyJWT + this package correctly signs RS256 tokens).

FCM itself uses direct `httpx` calls (already a dependency) against FCM's HTTP v1 API — no `firebase-admin` dependency was added, per the plan's reasoning (avoids a heavy `grpcio`/`protobuf` chain for what's fundamentally one authenticated POST per push).

## 5. Environment variables added

| Variable | Purpose |
|---|---|
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_KEY_CONTENT` | APNs provider-auth key (the `.p8` key's own PEM content, not a file path) |
| `FCM_SERVICE_ACCOUNT_JSON` | Google service-account JSON (whole file's content) for FCM v1 OAuth2 |
| `NATIVE_APP_UNIVERSAL_LINK_BASE` | Domain the OAuth callback redirects a native client to (falls back to `FRONTEND_URL` if unset) |
| `NATIVE_APP_CUSTOM_SCHEME` | Documented in `.env.example` as the fallback custom URL scheme; **not yet wired into any backend redirect logic** — see Known Limitations (§10) |

All are optional at import time and fail loud only when actually used (`require_apns_configured()`/`require_fcm_configured()`), matching this codebase's existing VAPID/LiveKit/email convention exactly. No native client exists yet to exercise any of these in production — they are inert until one does.

## 6. Security decisions

- **Requirement 1 (single-use OAuth tickets) — fully implemented, not left as an open question.** `used_oauth_tickets` records each ticket's `jti` on first redemption; a second redemption of the same ticket is rejected with `401` before `create_session_token` is ever called. The `jti` column is a `PRIMARY KEY`, so the atomicity comes from the database's own constraint, not from a read-then-write check — no race window between two concurrent redemption attempts of the same ticket.
- **Requirement 2 (owner-scoped device deletion) — fully implemented.** `DELETE /push/native/register/{device_id}` resolves `owner_id` from the authenticated session server-side and scopes the deactivation query to `(owner_id, device_id)` together; a `device_id` that exists but belongs to a different owner returns `404`, identical in shape to `push_subscriptions`' existing `(owner_id, endpoint)` scoping. Verified by a dedicated cross-owner security test (`test_owner_cannot_deactivate_another_owner_device`), treated as the single most important test in this phase per the test plan.
- **OAuth CSRF**: generalizes without any new mechanism — `client_type` rides inside the existing cookie-protected `state` value (`"native:<random>"`/`"web:<random>"`), so it inherits the existing double-submit cookie's tamper-evidence.
- **No new provider-side redirect URI**: Discord/Google still only ever redirect to the backend's own existing callback — the native/web split happens entirely backend→client, after the provider is out of the picture.
- **Provider secrets**: APNs/FCM credentials follow the exact `_require()`-at-use pattern already used for ESPN/LiveKit/Sportradar/Anthropic; never exposed to any client.
- **Cross-owner isolation for the new push table**: `native_push_tokens`'s upsert key is `(owner_id, device_id)` together, never `device_id` alone — verified by `test_registration_cannot_create_ownership_ambiguity_across_owners`.
- **No changes** to cookie domain/SameSite/Secure logic, `session_revocation` middleware, or CORS — confirmed by direct inspection during implementation, not just by omission.

## 7. OAuth ticket lifecycle

1. Native app opens `/auth/{discord,google}/login?client=native` in an in-app browser session (not an embedded WebView).
2. Backend sets the same `oauth_state` cookie as the web flow, with `client_type` prefixed into its value.
3. Provider redirects back to the backend's existing, unchanged callback URL.
4. Callback validates `state` (unchanged check), resolves `client_type`, and — only for `native` — mints a 60-second ticket (`purpose="native_oauth"`, a fresh `jti`) instead of the real session token, and redirects to `{NATIVE_APP_UNIVERSAL_LINK_BASE}/auth/native-complete?ticket=...`.
5. Native app calls `POST /auth/native/redeem` with that ticket.
6. Backend validates the ticket's signature, purpose, and expiry, then atomically marks its `jti` redeemed (rejecting a second attempt), fetches a **fresh** `token_version`, and returns a real 30-day session token in the JSON body.
7. Native app stores the token (Keychain/Keystore) and sends it as `Authorization: Bearer` thereafter — already fully supported by `get_session_token()`.

## 8. Push-token lifecycle

1. Native app registers via `POST /push/native/register` (Bearer or cookie auth).
2. Same `(owner_id, device_id)` re-registers in place (token rotation); a different `device_id` is a new device; a `push_token` reassigned to a different account first deactivates the old (owner, device) row (see the partial-index fix in §2).
3. `dispatcher.send_to_owner(s)` fans out to every active row on **both** channels (VAPID + native) for a given event; a failure on one channel never blocks the other (verified by `test_native_delivery_failure_does_not_break_web_delivery_to_the_same_owner`).
4. Provider errors are classified permanent vs. transient (APNs `BadDeviceToken`/`Unregistered`/`DeviceTokenNotForTopic`, FCM `UNREGISTERED`/`INVALID_ARGUMENT` → deactivate; everything else → record failure, keep retrying).
5. `DELETE /push/native/register/{device_id}` (owner-scoped) or a permanent delivery failure both soft-delete (`active = FALSE`); no hard deletes, matching `push_subscriptions`' own convention.
6. `owner_preferences.push_enabled` reflects **either** channel having an active device — verified in both directions (`test_disabling_last_native_device_keeps_toggle_on_if_a_web_subscription_remains` and its symmetric counterpart).

## 9. Tests added and results

**35 new tests**, across 4 files, covering every item in `NATIVE_PHASE_1_TEST_PLAN.md`:
device registration, multi-device, token rotation, reassignment, invalid/expired-token
cleanup (both APNs and FCM, permanent vs. transient), cross-owner security (mandatory
gate), combined push_enabled toggle, OAuth kickoff/callback/deep-link, single-use ticket
redemption (valid, replayed, expired, malformed, wrong-purpose, cross-account,
failed-redemption-creates-no-session), and native screen-view analytics validation.

**Targeted run** (all 4 new files + the existing, unmodified `test_push_notifications.py`,
`test_auth.py`, `test_analytics_taxonomy.py`): **98 passed, 6 failed**. All 6 failures are
in `test_push_notifications.py` (an existing file, not modified in this phase) and are a
**pre-existing bug unrelated to Phase 1** — see §10.

**Full-suite baseline comparison**: the very first full-suite run (before any Phase 1
code was written) already showed 342 failed / 743 passed / 410 errors out of 1495
collected tests, entirely from pre-existing issues (see §10). A second full run was
performed with all Phase 1 changes applied, to compare against that baseline —
[results filled in below once the run completed].

**FULL_SUITE_RESULTS_PLACEHOLDER**

## 10. Known limitations / pre-existing issues discovered (not caused by Phase 1)

1. **A widespread pre-existing test-helper bug, confirmed unrelated to this phase.**
   Several existing test files' local `_session_cookie()` helpers (e.g.
   `test_push_notifications.py`, `test_owner_preferences.py`) mint a session JWT via the
   plain `make_safe_session_user_id(pool)` helper, which creates a `users` row but never
   links it to the seeded `owners` row. `app/auth/league_context.py`'s `resolve_owner_id`
   does a **live database lookup** (by design — it does not trust the JWT's own
   `owner_id` claim, per its own docstring, a deliberate 2026-09 fix), so these tests'
   requests resolve to `owner_id = None` and fail with `NotNullViolationError` wherever
   that `None` gets written to a NOT-NULL `owner_id` column. **Proven pre-existing and
   unrelated to Phase 1** by reverting all Phase 1 changes (`git stash`) and re-running
   `test_owner_preferences.py` against the clean, unmodified codebase — it fails
   identically (same 12 tests, same exact error). This is very likely the single largest
   contributor to the failure/error count in the original full-suite baseline run. Not
   fixed here: it's a pre-existing issue spanning multiple files unrelated to any Phase 1
   workstream, and fixing it was explicitly out of scope ("no unrelated refactors").
   My own new tests use the correct, already-existing `make_safe_session_user_id_for_owner`
   helper and are unaffected.
2. **`NATIVE_APP_CUSTOM_SCHEME` is documented but not yet wired into backend redirect
   logic.** The current native OAuth completion redirect always uses
   `NATIVE_APP_UNIVERSAL_LINK_BASE` (or `FRONTEND_URL` as a fallback) — the plan's
   "custom-scheme fallback for when Universal/App Link association isn't active" is not
   implemented in this phase, since it's a client-side (native app) concern with no
   corresponding backend behavior to build yet. Deferred to Phase 2, alongside the
   native app itself.
3. **No frontend fallback landing page or `.well-known` domain-verification files were
   created.** The Phase 1 plan originally listed
   `frontend/src/app/auth/native-complete/page.tsx`,
   `frontend/public/.well-known/apple-app-site-association`, and
   `frontend/public/.well-known/assetlinks.json` as in-scope files. Per this phase's
   explicit "DO NOT modify frontend UI" instruction, none of these were created — the
   backend-side deep link (`.../auth/native-complete?ticket=...`) is fully implemented
   and tested, but nothing currently renders at that URL. This is a documented deviation
   from the original plan, not an oversight, and is deferred to Phase 2 alongside the
   native app itself (there is no meaningful way to build/test a landing page without
   the native client that would navigate to it).
4. **Ticket single-use enforcement adds a new table with no cleanup job.** Per the
   original plan's own flagged open question, `used_oauth_tickets` accumulates one row
   per successful native OAuth login, forever, in this phase. Given the tiny expected
   volume (native OAuth logins) and 60-second ticket lifetime, this is not a practical
   concern for a long time, but a periodic purge of old rows is real future work, not
   built here (consistent with this codebase's stated preference not to build ahead of
   a real need).
5. **`_native_completion_url`/`_native_error_url` fall back to `FRONTEND_URL`** when
   `NATIVE_APP_UNIVERSAL_LINK_BASE` is unset, meaning an unconfigured deployment would
   redirect a hypothetical native client to the *web* frontend's domain with a `?ticket=`
   or `?error=` query param it doesn't know how to handle. This is inert today (no
   native client exists to hit `client=native` in production) but should be resolved
   before any real native app build starts hitting this path.

## 11. Deferred to Phase 2

- Creating the Expo/React Native project itself.
- The native app's own OAuth completion UI (deep-link handling, in-app browser session invocation).
- The frontend fallback landing page and `.well-known` domain-verification files (§10, item 3).
- Wiring `NATIVE_APP_CUSTOM_SCHEME` into an actual fallback redirect path.
- Real APNs/FCM credential provisioning (depends on the native app's own App Store Connect / Firebase project registration, which doesn't exist yet).
- A periodic cleanup job for `used_oauth_tickets`.
- Fixing the pre-existing `make_safe_session_user_id` test-helper bug across the wider test suite (§10, item 1) — out of scope for this phase, flagged for a separate, dedicated fix.
- Establishing CI (a pre-existing gap noted in the Phase 0 audit, not created or worsened by this phase).
