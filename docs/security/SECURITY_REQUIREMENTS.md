# Security Requirements — The Weekend TV

**Status: PROPOSED requirements.** Each item gets a test (see Phase 9).

## Device pairing

- Pairing codes: 8 characters from an unambiguous alphabet (no 0/O/1/I), valid for 10
  minutes, redeemable once. Each code is bound to a high-entropy `device_code` that
  only the TV holds.
- Rate limits:
  - `pair/start`: 5 per IP per 10 minutes.
  - `pair/approve`: 10 tries per user per 10 minutes, then lockout.
  - `pair/token` polling: no faster than the stated interval, or `slow_down`.
- On approval, the user sees the device name and approximate time and confirms the
  league scope. Approval requires a normal signed-in session (cookie or Bearer).
- No passwords are ever entered on the TV.

## Device sessions

- Access token: a JWT valid for about 1 hour with `aud="tv"`, `device_id` and
  `scope="tv:read"`. Refresh token: opaque, stored only as a SHA-256 hash, and rotated
  on every use. If a used refresh token is presented again, the whole device is
  revoked.
- Device expiry: 90 days without use. Users can revoke from "Your TVs" on the website
  and phone app, and revocation takes effect on the next request or WS heartbeat
  (WS rechecks every 60 seconds).
- `aud="tv"` tokens are rejected by every non-`/tv/v1` route and every write route.
  Phone and web session tokens are rejected on `/tv/v1` data routes, except pairing
  approval and device management.
- On the TV, tokens live in EncryptedSharedPreferences / Android Keystore. They are
  never logged, and backups are excluded (`android:allowBackup="false"`).

## Permissions (server-side, every request)

- Private mode: `require_member_of(league)` for the device's user, re-checked per
  request (membership can change after pairing).
- Public mode: a league is readable only when its commissioner turned on
  `league_public_profiles`, and only for allowlisted sections. Public responses are
  built by separate serializers that physically lack private fields. The design does
  not rely on stripping fields out of a private response.
- **Never shown on a TV in any mode:** kitty and dues amounts, DMs and chat,
  emails, birthdays, gender, push tokens, ESPN/Sleeper credentials, commissioner
  tools, and draft or trade write actions.
- League bets board: members-only (private mode). It shows units, never stakes, and
  respects any per-user hide setting.
- Commissioner announcements: the commissioner chooses which Commish Corner posts are
  "On TV".

## Data and licensing

- The live NFL data comes today from ESPN's undocumented public endpoints. That is
  acceptable for internal and private-league testing. **Before distributing to other
  leagues on Google Play**, move to a licensed feed (Sportradar code exists) or get
  written permission. No scraping beyond what the backend already does. No purchases
  without approval.
- Each section of the brief that needs licensed data (play-by-play redistribution) is
  labeled as such in the UI ("Source: ESPN, delayed" or similar).

## Transport and app

- HTTPS and WSS only. Cleartext is disabled in `network_security_config`.
- No secrets in the APK. The API base URL is the only build config.
- The release keystore lives outside git (already gitignored: `*.keystore`).
- R8 minification on release builds.

## Testing data

Backend tests must run against a localhost `DATABASE_URL` only (`backend/.env` is
prod). TV UI tests use the mock gamecast provider and seeded fixture leagues, never
real member data.
