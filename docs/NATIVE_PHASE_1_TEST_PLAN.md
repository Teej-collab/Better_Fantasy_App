# Native Migration — Phase 1 Test Plan

Status: **PLANNING ONLY. No tests have been written.** Companion to
`docs/NATIVE_PHASE_1_PLAN.md`. Builds on the existing `backend/tests/` pytest suite
(89 files today, `pytest.ini` with `asyncio_mode = auto`, `conftest.py` fixtures,
`fakes_espn.py`-style fake providers as the established convention for mocking external
services). New tests should follow that same convention — a `fakes_apns.py`/
`fakes_fcm.py` pair analogous to `fakes_espn.py`, rather than hitting real Apple/Google
endpoints in CI.

The single most important property across every test group below: **every existing
test in the current suite must continue to pass unmodified.** That is the concrete,
verifiable definition of "backwards compatible" for this phase — not just a stated
intention in the plan doc.

---

## 1. Web push regression (must keep passing unmodified)

Purpose: prove the native additions haven't disturbed the existing VAPID path.

- Existing `test_push_*.py` (or wherever current push tests live) suite: run
  unmodified, all green, before and after the Workstream 1 changes.
- `send_to_owner`/`send_to_owners` with an owner who has **only** `push_subscriptions`
  rows (no `native_push_tokens` rows): confirm VAPID delivery still happens exactly as
  before, and confirm no attempt is made to query/dispatch to the native table for an
  owner with zero rows there (a cheap no-op, not an error).
  path affects the outcome.
- `/push/subscribe`, `/push/unsubscribe`, `/push/test`: request/response shapes
  unchanged; existing test assertions on these should not need modification.

## 2. Native device registration

- `POST /push/native/register` with a new `(owner_id, device_id)`: creates a new row,
  `active = TRUE`, returns `{id, device_id, platform, active}`.
- `POST /push/native/register` called twice with the same `(owner_id, device_id)` but
  a different `push_token` (simulating OS token rotation): second call updates the
  existing row in place (same `id`), does not create a duplicate row.
- `POST /push/native/register` with a `push_token` that already exists under a
  **different** `(owner_id, device_id)` (simulating reinstall-under-a-different-account): the old row is deactivated, the new row is created/updated correctly, and no
  unique-constraint violation occurs.
- `POST /push/native/register` for a signed-in user with no `owner_id` yet: returns
  the appropriate error status (confirm exact expected behavior against
  `/push/subscribe`'s current handling of this same edge case during implementation).
- `POST /push/native/register` with an invalid `platform` value (not `ios`/`android`):
  `422`.
- `POST /push/native/register` sets `owner_preferences.push_enabled = TRUE`, matching
  `/push/subscribe`'s existing behavior.
- Auth: request with no session → `401`; request with a valid Bearer token (no cookie)
  → succeeds, proving the native Bearer-token path works end-to-end for this new route.

## 3. Multiple devices per owner

- One owner registers two devices with different `device_id`s (e.g. phone + tablet):
  both rows exist and are both active; both receive a dispatched notification
  independently (verify via the fake APNs/FCM senders that both were called).
- Deactivating one device (`DELETE .../register/{device_id}`) leaves the other active
  and still receiving notifications.

## 4. Token rotation

- Re-registering the same `device_id` with a new `push_token` updates `push_token`,
  `app_version`, `os_version`, `updated_at` in place; `id` and `created_at` are
  unchanged; no duplicate row.
- A dispatch sent after rotation uses the **new** token, not the old one (verify the
  fake sender receives the updated token value).

## 5. Invalid/expired token cleanup

- Fake APNs sender returns `BadDeviceToken` (or `Unregistered`/
  `DeviceTokenNotForTopic`) for a given token: after dispatch, that row's `active`
  flips to `FALSE` and `last_failure_at` is set; a subsequent dispatch to the same
  owner does not attempt delivery to that row again.
- Fake APNs sender returns a transient error (e.g. `TooManyRequests` or a network
  timeout): row's `active` remains `TRUE`, only `last_failure_at` updates; a
  subsequent dispatch retries delivery to that row.
- Same two cases mirrored for the fake FCM sender (`UNREGISTERED`/`INVALID_ARGUMENT` =
  permanent; `UNAVAILABLE`/`INTERNAL`/network error = transient).
- A successful delivery updates `last_successful_delivery_at` and leaves `active`
  unchanged (`TRUE`).

## 6. Logout / explicit unregister

- `DELETE /push/native/register/{device_id}` for an existing, owner-matching device:
  `204`, row's `active` flips to `FALSE`.
- Same call for a `device_id` that doesn't belong to the caller's `owner_id` (but
  exists under a different owner): `404` — confirms an owner cannot deactivate another
  owner's device by guessing an ID.
- Same call for a nonexistent `device_id`: `404`.
- After deactivating an owner's only native device while they still have an active
  `push_subscriptions` row: `owner_preferences.push_enabled` stays `TRUE` (combined-channel check).
- After deactivating an owner's only native device **and** they have zero active
  `push_subscriptions` rows: `owner_preferences.push_enabled` flips to `FALSE`.
- Symmetric case: unsubscribing an owner's only `push_subscriptions` row while they
  still have an active native device: `push_enabled` stays `TRUE` (verifies the
  extended check works in both directions, not just the native-added direction).

## 7. OAuth success (native flow)

- `GET /auth/discord/login?client=native`: generated `state` carries the `native:`
  prefix; `oauth_state` cookie is set as today.
- Full callback simulation (mocking Discord's token endpoint, as existing OAuth tests
  presumably already do): `state` validates correctly against the cookie; the final
  redirect target is the native universal-link URL with a `?ticket=` param, **not**
  the web `#token=` fragment; no `Set-Cookie` is issued in this branch.
- `POST /auth/native/redeem` with the ticket from the redirect: returns `200` with a
  valid `{"token": ...}` body; the returned token is a valid, fully-functional session
  JWT (verify it works against an existing protected endpoint, e.g. `/auth/me`, via
  `Authorization: Bearer`).
- Same success-path test repeated for Google OAuth.

## 8. OAuth cancellation

- Simulate the in-app browser session being cancelled before any callback request
  reaches the backend: confirm no backend state is created or mutated (no ticket
  minted, no `oauth_state` cookie consumed) — this is inherently a client-side/OS-level
  event with no backend interaction, so the test here is really "confirm the backend
  has nothing to clean up," documenting the expected no-op rather than testing new
  code.

## 9. OAuth failure

- Provider returns `?error=access_denied` (user declined at Discord/Google): for
  `client_type == "native"`, confirm redirect goes to the native error deep link with
  an error-code param, not the web `/login?error=...` path.
- Discord-specific: authenticated Discord account is not an existing league member —
  confirm the existing `not_a_league_member` error case (currently redirects to
  `/login?error=not_a_league_member` for web) correctly branches to the native error
  deep link equivalent when `client_type == "native"`.
- `state` mismatch or missing `oauth_state` cookie: `400` for both web and native flows
  (unchanged, generic failure — confirm this is NOT accidentally routed to either
  redirect target, since an unvalidated `state` cannot be trusted to determine
  `client_type`).

## 10. Deep-link handoff

- Ticket redemption with a well-formed but **expired** ticket (past the 60-second
  window): `401`.
- Ticket redemption with a ticket minted for a **different purpose** (e.g. a chat-WS
  ticket): `401` — confirms purpose-scoping (`decode_ticket_token(..., purpose="native_oauth")`) rejects cross-purpose reuse, an existing property of the ticket
  mechanism that must continue to hold for the new purpose.
- Ticket redemption with a garbage/tampered ticket string: `401`, no exception leaks
  a stack trace or internal detail.

## 11. Replay protection

- Redeem a valid ticket once (succeeds), then attempt to redeem the **same** ticket
  string again within its validity window: document actual current behavior — per
  `NATIVE_PHASE_1_PLAN.md`'s open question, single-use enforcement is not required for
  this phase, so this test should assert today's actual behavior (a second redemption
  within the 60-second window also succeeds, minting a second valid session token) as
  a **known, accepted** behavior, not silently pass or silently xfail. If single-use
  enforcement is later added (per the open question), this test should be updated to
  assert the second redemption is rejected.

## 12. Analytics events

- `POST /admin/track` with `event_type: "page_view"`, a non-null `route`, no
  `platform`: unchanged existing behavior — `event_name` validated against
  `NAV_EVENT_NAMES` from `classify_route(route)`, event stored with `platform: null`.
- Same request with an explicit `platform: "ios"` and a non-null `route` (simulating
  today's actual Capacitor-wrapped app, which already sends both): unchanged behavior,
  `platform` stored as sent.
- `POST /admin/track` with `event_type: "page_view"`, `route: null`, `platform: "ios"`,
  `event_name` in the new `SCREEN_NAMES` set: accepted, stored with `route: null`.
- Same request with `route: null` and `event_name` **not** in `SCREEN_NAMES`: rejected
  (matching the existing rejection behavior for an invalid `page_view` name today).
- `route: null` with `platform: "web"`: rejected — this combination is defined as not
  meaningful (§5 of the main plan); confirm the validation actually enforces this
  rather than silently accepting it.
- `route: null` with `platform` omitted entirely: rejected — `platform` is required in
  this branch, unlike the `route`-present branch where it's optional.
- Existing curated `feature` events (`league_switched`, `gamecast_game_selected`):
  unchanged behavior, unaffected by any of the above changes.

## 13. Web regression (analytics)

- Full existing analytics test suite (whatever currently covers `taxonomy.py`/
  `validate_event`/`POST /admin/track`) passes unmodified.
- Frontend `detectPlatform()` change: for a request with no Capacitor runtime present
  (plain browser), confirm the function still returns the same value the UA-regex path
  produces today (i.e., the Capacitor-preference check is additive and doesn't change
  behavior when Capacitor isn't present) — this is a frontend unit test, not a backend
  pytest, and should live alongside whatever existing frontend test tooling covers
  `analyticsEvents.ts`, if any (per the Phase 0 audit, no frontend test suite currently
  exists beyond an unused Playwright devDependency — flag this as a gap if no test
  runner is available to actually execute this check, rather than silently skipping
  it).

## 14. Authorization/security

- `POST /push/native/register` and `DELETE /push/native/register/{device_id}`: no
  session → `401` for both.
- `DELETE /push/native/register/{device_id}` cross-owner isolation test (§6, second
  bullet) — the single most important security test in this plan, since it's the one
  place a missing scope check would leak cross-owner control.
- `POST /auth/native/redeem`: confirm it does **not** accept a regular session JWT in
  place of a ticket (purpose-scoping must reject it) — verifies the new endpoint can't
  be used as an unintended alternate path into an existing session.
- Confirm `session_revocation` middleware behavior is unchanged for both cookie and
  Bearer-token requests after these changes (a quick regression check, not new
  functionality — this middleware must not be touched per the plan's explicit
  constraints, but its *behavior* should be re-verified after any change to
  `auth.py`/`session.py` in the same PR, as a safety net).
- Confirm CORS behavior is unchanged (no new origins added, no credentialed-request
  behavior change) — regression check, not new functionality.
- Confirm no APNs/FCM credential (`.p8` key content, FCM service-account JSON) ever
  appears in a log line, error message, or API response across all of the above tests
  — spot-check via test-log inspection in CI, matching the existing discipline applied
  to other provider secrets (ESPN, LiveKit, Sportradar) in this codebase.

---

## Test infrastructure notes

- New fake provider modules (`backend/tests/fakes_apns.py`, `backend/tests/fakes_fcm.py`) should follow `fakes_espn.py`'s existing pattern: a drop-in replacement injected via
  the same fixture-override mechanism `conftest.py` already uses for ESPN, returning
  configurable success/permanent-failure/transient-failure responses per test case.
- No test should make a real network call to Apple or Google's push infrastructure —
  matches the existing convention of never hitting real ESPN/Sportradar/LiveKit
  endpoints in the test suite.
- These new tests are not currently run in any CI pipeline (per the Phase 0 audit
  finding that no CI exists in this repo today) — running the full suite, including
  these additions, before merge remains a manual step until CI is established. This is
  a pre-existing gap this plan does not resolve, only inherits.
