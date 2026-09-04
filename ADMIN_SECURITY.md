# Admin Security

## The one authorization boundary

Every `/admin/*` **dashboard** endpoint (Overview, Users, Leagues, Navigation, Online, and the admin-grant endpoint itself) is gated by `require_site_admin` (`app/auth/league_context.py`) — a live database check, run **independently, inside every single endpoint**, not a shared middleware and not a frontend guard. The six ESPN-sync/compute endpoints in the same router (`/sync`, `/sync/live`, `/weekly-compute`, `/sync/bye-weeks`, `/players/sync`, `/players/sync-projections`) are a separate, narrower grant — see "Two separate grants" below.

`require_site_admin` passes if **either** of two things is true:
1. The caller is League #1's commissioner (`is_commissioner` scoped to `DEFAULT_LEAGUE_ID` specifically — not "whichever league is currently active," which is a different, broader check the frontend also reads as plain `is_commissioner`).
2. `users.is_admin` is set directly on their account (2026-09 addition — see "Granting admin to someone else" below).

Either is sufficient on its own; neither is required if the other holds. `is_site_owner` on `/auth/me` is this same combined check, exposed to the frontend so `AccountMenu.tsx` knows whether to show the Admin link.

There is still no broader role hierarchy (Owner/Support/Analyst/Moderator) — deliberately. `is_admin` is a flat, single boolean: you either have dashboard access or you don't, granted by another admin. Building a tiered permissions system for roles nobody's asked for is complexity with no payoff yet.

## Two separate grants — don't confuse them

- **League #1 commissioner** (`league_members.role = 'commissioner'` for league 1) — a much bigger grant: full control of League #1 itself (scoring rules, roster edits, trades, ESPN sync triggers) *and* the admin dashboard as a side effect.
- **`users.is_admin`** — dashboard access *only*. Granting this to someone does **not** make them League #1's commissioner and does **not** let them trigger the six ESPN-sync/compute endpoints, which still check `require_commissioner_of(DEFAULT_LEAGUE_ID)` directly and don't accept the `is_admin` flag at all.

This split exists specifically so the real owner can hand someone (e.g. a second real person helping run things) visibility into usage/users/leagues without also handing them the much bigger keys to League #1 itself.

## Granting admin to someone else

`PATCH /admin/users/{user_id}/admin` (body: `{"is_admin": true|false}`), gated by `require_site_admin` itself — any current admin can grant or revoke another user's flag. Two safety rules, both enforced server-side:

- **Can't target your own row.** Same "the only way to lose access is someone else doing it to you" pattern as `PATCH /leagues/{id}/members/{user_id}`'s own role changes — real risk here specifically, since revoking your own `is_admin` through this endpoint could otherwise lock you out of the very screen you'd need to undo it from (unless you're also League #1's commissioner, which not every admin necessarily is).
- **404 for an unknown user_id**, not a silent no-op.

The frontend's Grant/Revoke Admin button lives on each user's own Admin > Users detail page (`AdminUserDetail.tsx`) — nowhere else, and not exposed to the person being granted/revoked (they'd need to already be an admin to see that page at all).

## What "independently, inside every endpoint" means in practice

```python
@router.get("/users")
async def list_users(request: Request, ...):
    payload = _require_session(request)          # 1. authenticated?
    ...
    async with pool.acquire() as conn:
        await require_commissioner_of(conn, payload, DEFAULT_LEAGUE_ID)   # 2. authorized?
        result = await admin_users.list_users(conn, ...)                  # 3. only then, the query
    return result
```

Every admin endpoint follows this exact shape. There is no endpoint that trusts a client-supplied role claim, a JWT flag set at login, or "the frontend wouldn't show this link to a non-admin." The frontend's `/admin/layout.tsx` does check `is_site_owner` before rendering admin pages at all — that's a UX nicety (don't show pages that will just 403), never the actual boundary. Calling any `/admin/*` endpoint directly with a non-owner session — curl, a modified request, whatever — gets a real 403, not app-visible data. This is tested directly (see below), not just asserted.

## `POST /admin/track` is intentionally different

It's the one `/admin/*` endpoint **not** gated by `is_site_owner` — every signed-in owner can call it, because it only ever writes an event tagged with **their own** `owner_id`. That identity is never taken from the request body; it comes from the decoded session, exactly like every other owner-scoped write in this app (chat messages, lineup moves, etc.). There is no `owner_id` field in `TrackEventRequest` at all — there's nothing in the payload to spoof. A user attempting to record an event as someone else has no request shape that would even attempt it.

## Event validation — closing the "analytics as a backdoor" risk

Before any event is written, `app/analytics/taxonomy.py`'s `validate_event` runs:

1. `event_type` must be `page_view` or `feature` — nothing else.
2. `event_name` must be in the known taxonomy for that type (`NAV_EVENT_NAMES` or `FEATURE_EVENTS`) — an unrecognized name is rejected outright (400), not stored with a "we'll figure it out later" shrug.
3. For a `feature` event, `metadata` may **only** contain the keys that specific event allows (`FEATURE_EVENTS[event_name]`) — any other key, including something that looks like it's trying to smuggle a password or token through, is rejected.
4. `device_type`/`platform` must be one of a fixed small enum or null.

This is what stops the analytics system itself from becoming a way to write arbitrary data into the database under the guise of telemetry — see `ANALYTICS_EVENTS.md` for the full taxonomy this validates against.

## Rate limiting

`POST /admin/track` has an in-memory, per-owner, 60-events-per-60-seconds cap (`app/analytics/rate_limit.py`) — the same fixed-window shape and same "in-process, per-instance, accepted trade-off at this scale" reasoning as the existing login/signup rate limiter. Real navigation never comes close to it; it exists to stop a buggy or malicious client from flooding the table, not to throttle normal use.

## What a user detail page never shows

`app/queries/admin_users.py`'s own queries never select `password_hash`, session tokens, push subscription credentials, or password-reset/email-verification tokens (this app has no email verification concept at all — see `ADMIN_DASHBOARD.md`). There's nothing to accidentally leak because the query never fetches it in the first place, not because a template happens to skip a field. Tested directly (`test_user_detail_never_includes_password_hash_or_secrets`).

## League isolation

Admin endpoints that surface league data (`GET /admin/leagues/{id}`) are readable by the site owner regardless of which league it is — that's the whole point of an admin view. This is **not** the same authorization model as a regular member's own `/league` page (which is scoped to their own active league); the admin boundary is "are you the site owner," full stop, applied uniformly across every league's data. A regular commissioner or member has no path to another league's data through these endpoints — they 403 before any league-scoped query ever runs.

## Testing

Every new admin capability has a paired test:

- `test_*_requires_session` — no cookie at all → 401.
- `test_*_rejects_non_commissioner` — signed in, real account, genuinely not the site owner → 403.
- A real success-path test proving the endpoint actually returns correct data for the site owner.
- `POST /admin/track`: rejects an unknown event name, rejects a disallowed metadata key, rejects a type/name mismatch, silently no-ops for a session with no `owner_id`, and — critically — the row it writes is provably tagged with the caller's own `owner_id`, never a client-supplied one.

See `backend/tests/test_admin.py` and `backend/tests/test_analytics_taxonomy.py`.

## Known limitations (honest, not hidden)

- No audit log of admin actions yet (viewing a user's profile, etc. isn't itself recorded) — Phase 2.
- No security-event logging (failed logins, permission denials) — Phase 2, needs its own pipeline.
- Rate limiting is in-process/per-instance — fine for this single-instance deployment; would need a shared store (Redis) if this ever ran as more than one backend process.
