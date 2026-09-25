# Native Migration — Phase 1 Database Changes

Status: **PLANNING ONLY. No migration has been written or run.** Companion to
`docs/NATIVE_PHASE_1_PLAN.md`. This is the only workstream of the three (push, OAuth,
analytics) that requires a schema change — OAuth reuses the existing stateless
ticket-token mechanism, and analytics' `platform`/`route` columns already exist.

---

## New table: `native_push_tokens`

### Purpose

Stores one row per (owner, device) native push registration — the APNs/FCM analog of
the existing `push_subscriptions` table (Web Push/VAPID). Additive: does not replace,
alter, or share rows with `push_subscriptions`.

### Proposed schema

```sql
CREATE TABLE native_push_tokens (
    id                          SERIAL PRIMARY KEY,
    owner_id                    INTEGER NOT NULL REFERENCES owners(owner_id),
    device_id                   TEXT NOT NULL,
    platform                    TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    push_token                  TEXT NOT NULL,
    app_version                 TEXT,
    os_version                  TEXT,
    active                      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at                TIMESTAMPTZ,
    last_successful_delivery_at TIMESTAMPTZ,
    last_failure_at             TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_native_push_tokens_owner_device
    ON native_push_tokens (owner_id, device_id);

CREATE UNIQUE INDEX idx_native_push_tokens_push_token
    ON native_push_tokens (push_token) WHERE active;

CREATE INDEX idx_native_push_tokens_owner_id
    ON native_push_tokens (owner_id) WHERE active;
```

Migration style should match the existing `push_subscriptions` migration
(`backend/migrations/versions/6a96fdae6d6c_add_push_subscriptions_table_for_web_.py`):
raw `op.execute("""...""")` SQL blocks (not `op.create_table`), explicit `upgrade()`/
`downgrade()` with `DROP TABLE native_push_tokens` in `downgrade()`, and the same
docstring header conventions (revision ID, "Revises:", "Create Date:").

### Column-by-column

| Column | Type | Purpose | Lifecycle / notes |
|---|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | Internal row identity | Never exposed to clients beyond the register-endpoint response, matching `push_subscriptions.id`'s existing usage. |
| `owner_id` | `INTEGER NOT NULL REFERENCES owners(owner_id)` | Ties the registration to the fantasy-league identity, not the login identity (`users.id`) | **Not** `users.id` — matches `push_subscriptions.owner_id`'s existing convention, since notifications are always about league/team events, and a signed-in user with no `owner_id` yet (hasn't joined/created a league) cannot register a device. No `ON DELETE` clause, matching `push_subscriptions`'s existing FK (no cascade defined there either) — see "Account deletion" below. |
| `device_id` | `TEXT NOT NULL` | Client-generated stable identifier for one physical device/app-install (iOS `identifierForVendor`, or an app-generated UUID persisted in Android Keystore/SharedPreferences) | Not a push token itself — stays stable across token rotation, which is exactly why it's the upsert key (see below). |
| `platform` | `TEXT NOT NULL CHECK (platform IN ('ios', 'android'))` | Which native push service to use for delivery | DB-level CHECK constraint (unlike `analytics_events.platform`, which enforces its allowlist in Python) because this value directly controls which provider branch (`aioapns` vs FCM) the dispatcher takes — a bad value here is a delivery-routing bug, not just a data-quality issue, which justifies the stricter DB-level guarantee. |
| `push_token` | `TEXT NOT NULL` | The APNs device token (hex string) or FCM registration token (opaque string) actually used to address a push | Opaque to the backend beyond routing by `platform`; never logged in full in application logs (only enough to disambiguate in error messages), matching how the codebase already treats `push_subscriptions.endpoint`. |
| `app_version` | `TEXT` (nullable) | The native app's version string at last registration | Diagnostic only — useful for correlating delivery failures with a specific app release; not used in any business logic. |
| `os_version` | `TEXT` (nullable) | The device OS version at last registration | Diagnostic only, same rationale as `app_version`. |
| `active` | `BOOLEAN NOT NULL DEFAULT TRUE` | Whether this registration should currently receive pushes | Soft-delete flag, mirroring `push_subscriptions.active`. Flipped to `FALSE` on explicit logout/unregister (via the new `DELETE /push/native/register/{device_id}` route) or on a permanent delivery failure (APNs `BadDeviceToken`/`Unregistered`, FCM `UNREGISTERED`/`INVALID_ARGUMENT`) — never hard-deleted, so delivery-failure history (`last_failure_at`) is preserved for diagnosis. |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Row creation time | Standard audit column, matches existing convention. |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Last time this row's mutable fields changed | Bumped on every re-registration (token rotation) and on `active` flips. |
| `last_seen_at` | `TIMESTAMPTZ` (nullable) | Last time the client actively re-registered (e.g. on app foreground) | Distinct from delivery timestamps — this reflects client-side liveness, not delivery success, useful for identifying stale registrations independent of whether a push was ever attempted. |
| `last_successful_delivery_at` | `TIMESTAMPTZ` (nullable) | Last time a push was successfully accepted by APNs/FCM for this row | Mirrors `push_subscriptions.last_successful_delivery_at`. |
| `last_failure_at` | `TIMESTAMPTZ` (nullable) | Last time a delivery attempt to this row failed (transient or permanent) | Mirrors `push_subscriptions.last_failure_at`. Combined with `active`, lets an operator distinguish "recently failing but still active (transient)" from "deactivated (permanent failure or explicit unregister)." |

### Relationships

- `owner_id → owners.owner_id`: many-to-one. One owner may have many active
  `native_push_tokens` rows (one per device) — this is how **multiple devices per
  owner** is supported, identically in spirit to how `push_subscriptions` already
  supports multiple browser endpoints per owner.
- No relationship to `push_subscriptions` — the two tables are entirely independent;
  an owner may have rows in one, both, or neither.
- No relationship to `users` directly — always mediated through `owners`, consistent
  with the rest of the notification system.

### Indexes and constraints, and why each exists

- **`UNIQUE (owner_id, device_id)`**: the primary upsert target. Handles **token
  rotation** (same device gets a new OS-issued token — client re-registers with the
  same `device_id`, the upsert overwrites `push_token`/`app_version`/`os_version`/
  `updated_at` in place, no duplicate row) and **multiple devices per owner** (a
  different `device_id` is simply a new row).
- **`UNIQUE (push_token) WHERE active`**: catches the case where the OS hands an
  identical opaque token to a reinstalled app now logged into a *different* account —
  without this constraint, the same physical device could end up receiving pushes
  intended for a previous account. Scoped `WHERE active` (a partial index, same idea as
  the owner_id index below) specifically so a deactivated row can keep its old
  `push_token` value for history without that value colliding with the same token's new
  active owner — an earlier, unconditional version of this index hit exactly that
  collision in testing, since deactivating a row only flips `active` to `FALSE`, it
  never clears `push_token`. Because a single `INSERT ... ON CONFLICT` can only target
  one constraint, the registration write path still deactivates any existing row where
  `push_token` matches but `(owner_id, device_id)` differs, then upserts on
  `(owner_id, device_id)` — mirroring `push_subscriptions`' existing endpoint-reassignment handling for the exact same class of problem, with the partial index doing the work an unconditional one couldn't.
- **Partial index `(owner_id) WHERE active`**: matches `push_subscriptions`' existing
  partial index — optimizes the hot-path dispatch query ("give me this owner's active
  registrations") without indexing soft-deleted rows.

### Security considerations

- `push_token` values are bearer-like in the sense that possessing one lets *a* server
  (with valid APNs/FCM credentials) address a push to that specific device — but they
  are not secrets in the same sense as a session token (they don't grant API access,
  only "can attempt to deliver a notification"). No encryption-at-rest beyond
  whatever the database provides at the infrastructure level; this matches how
  `push_subscriptions.endpoint`/`p256dh`/`auth` are stored today (plaintext columns,
  no additional application-level encryption).
- `owner_id` is always resolved server-side from the authenticated session
  (`resolve_owner_id()`), never accepted as a client-supplied value on the register
  endpoint — a device can only ever register itself against the caller's own
  `owner_id`, preventing one owner from registering (or later deregistering) another
  owner's device.
- The `DELETE /push/native/register/{device_id}` route must scope its `WHERE` clause
  to `(owner_id, device_id)` from the session, not `device_id` alone — otherwise one
  owner could guess another's `device_id` and deactivate their registration (a
  low-severity but unnecessary information/availability leak). This mirrors
  `push_subscriptions`' existing unsubscribe route, which is already scoped to
  `(owner_id, endpoint)`.

### Lifecycle summary

| Event | Effect on `native_push_tokens` |
|---|---|
| App install + first registration | New row inserted via `POST /push/native/register`. |
| Token rotation (OS issues new token, same device) | Existing `(owner_id, device_id)` row updated in place (`push_token`, `updated_at`). |
| New device added (e.g. tablet) | New row, new `device_id`, same `owner_id`. |
| App re-registers on foreground (no new token) | `last_seen_at` bumped; other columns unchanged. |
| Explicit logout / "turn off notifications" on one device | Row's `active` set `FALSE` via `DELETE /push/native/register/{device_id}` (soft-delete, row retained). |
| Delivery attempt returns a permanent failure (`BadDeviceToken`, `Unregistered`, `DeviceTokenNotForTopic`, `UNREGISTERED`, `INVALID_ARGUMENT`) | Row's `active` set `FALSE`, `last_failure_at` updated. |
| Delivery attempt returns a transient failure (rate limit, 5xx, network error) | `last_failure_at` updated only; row stays `active` for retry on the next event. |
| Delivery attempt succeeds | `last_successful_delivery_at` updated. |
| Account deletion | **No automated cleanup exists today** — confirmed no existing code path deletes `push_subscriptions` rows on account deletion either. This new table should be added to whichever future account-deletion routine is built, in lockstep with `push_subscriptions`, rather than getting bespoke handling now. Flagged as a pre-existing gap this table inherits, not a new one it introduces. |

### Migration considerations

- Purely additive `CREATE TABLE` — no existing table is altered, no backfill required,
  no downtime risk.
- Safe to deploy ahead of any native client existing: the table will simply have zero
  rows until a native app calls the new registration endpoint.
- `downgrade()` is a straightforward `DROP TABLE native_push_tokens` — safe at any
  point before real device registrations exist, and even after (it only removes push
  targeting data, not user-facing state, since no feature *requires* native push to
  function — it's an additive delivery channel).

---

## No schema changes for OAuth or Analytics workstreams

- **OAuth (Workstream 2)**: the native completion flow reuses the existing
  ticket-token mechanism (`create_ticket_token`/`decode_ticket_token`), which is a
  signed, stateless JWT — no database row is created or needed for a ticket. The only
  code-level (not schema-level) change is adding a new named purpose (e.g.
  `"native_oauth"`) to the existing `TICKET_PURPOSES` set.
- **Analytics (Workstream 3)**: `analytics_events.platform` (nullable `TEXT`) and
  `analytics_events.route` (nullable `TEXT`) already exist
  (`backend/migrations/versions/c8ca9b06b451_generalize_page_view_events_into_.py`).
  The new `SCREEN_NAMES` taxonomy is a Python-level allowlist addition in
  `taxonomy.py`, consistent with this table's existing convention of enforcing
  `event_name`/`platform` values in application code rather than via DB CHECK
  constraints (the rationale, per the existing design, is that a new allowed value
  should never require a migration). No migration is proposed for this workstream.
