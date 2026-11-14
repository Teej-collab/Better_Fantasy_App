# Target Architecture — The Weekend TV

**Status: PROPOSED. Not approved, nothing built.**

## Shape

```
            ESPN public feed / Sportradar (later, licensed)
                              │  (one poller, backend only)
                              ▼
┌──────────────────── FastAPI backend (Railway) ────────────────────┐
│ gamecast/service (ingest + normalize)                              │
│   → domain/scoring_engine (per-league rules)  ← existing          │
│   → domain/matchup_scoring, win_probability, playoff_odds ← exist │
│   → NEW tv/live_hub: per-league fan-out of score deltas           │
│ NEW routers/tv.py  (/tv/v1/*: pairing, bootstrap, screens)        │
│ NEW auth/device_session.py (tv_devices table, scoped tokens)      │
└──────────────┬─────────────────────────────┬──────────────────────┘
               │ REST + WS                   │ REST
               ▼                             ▼
   The Weekend TV (Android TV)     Website + phone app (existing)
   Kotlin + Compose for TV         + NEW "Connect a TV" page
                                   + NEW "Your TVs" list / revoke
```

There is one database, and the backend stays the only source of truth. The TV never
computes fantasy points, odds or standings. It only renders what the API sends.

## TV client technology (decision needed)

**Recommended: native Kotlin + Jetpack Compose for TV** (`androidx.tv:tv-material`),
in a new top-level `tv/` directory.

- Why:
  - It is Google's supported path for Google TV.
  - It has the best D-pad focus handling (focus restoration, `focusRestorer`,
    `BringIntoView`).
  - It is the smoothest option for animations on a Chromecast with 2 GB of RAM.
  - It gives us a small APK and native Play Store TV distribution.
- Cost:
  - A second UI language in the repo.
  - No EAS OTA, so every update is a new APK. That is fine through Play's internal
    test track.
  - Shared types come from the backend's OpenAPI schema, not `mobile/src/lib`.

**Alternative: Expo + `react-native-tvos`**, either as a TV target of `mobile/` or as a
sibling app.

- Pros: reuses the TypeScript API client and types, and gets OTA updates.
- Cons: weaker focus management and heavier animations on Chromecast, and
  `react-native-tvos` versions trail upstream RN. That trailing is a risk because the
  phone app sits on RN 0.86.

Library versions get verified when Phase 2 starts.

## New backend pieces

1. **`tv_devices` table**:
   - Columns: id, user_id, league_id (nullable, for public mode), name, created_at,
     last_seen_at, expires_at, revoked_at, token_hash, refresh_hash.
   - Gives each TV its own revocable session, independent of `users.token_version`.
2. **`tv_pairing_codes` table**:
   - A short code (8 characters, unambiguous alphabet), a device_code (a high-entropy
     secret only the TV holds), expiry of 10 minutes, a one-time redeemed_at, and
     approved_by_user_id.
   - Follows the RFC 8628 device-authorization pattern.
3. **TV-scoped tokens**:
   - A short-lived access JWT (about 1 hour), with `aud: "tv"`, a `device_id` claim
     and a read-only scope.
   - A rotating refresh token (hashed in the database, reuse is detected).
   - Middleware rejects `aud: "tv"` tokens on any write route.
4. **Public league mode**:
   - `league_public_profiles`: a commissioner opt-in plus a per-section allowlist
     (scores, standings, recaps, bracket).
   - Never bets, kitty, chat, or member contact info.
   - The same pattern as `share_links`, at league scope.
5. **`/tv/v1/*` routes**, aggregated per screen so the TV makes one call per screen:
   - `bootstrap` (leagues, week, branding)
   - `broadcast`
   - `gamecast/{game}`, which reuses gamecast service models
   - `league-center`
   - `lounge`
   - `devices` (list and revoke, for the website and phone)
6. **`tv/live_hub`**:
   - One WS per TV, subscribed to one league channel.
   - When the existing gamecast poll finishes, the hub re-reads changed
     `player_week_stats` for leagues that have a TV subscriber, then pushes
     `{seq, matchup_id, scores, win_prob}` deltas.
   - Events carry a monotonically increasing `seq` per league, so the TV drops
     duplicates and asks for a resync on gaps.
7. **Broadcast commentary**: a small Haiku-first writer fed only verified scoring
   events (the narrative-engine fact-payload rule). It is cached per event, never
   blocks scores, and is off by default.

## Reused as-is

Scoring engine, matchup scoring, win probability, playoff odds and bracket, records,
power rankings, awards, recaps and previews, rivalry detection, Commish Corner, the
league bets board, the activity feed, gamecast models and history buffer, push, and
`require_member_of` / `require_commissioner_of`.

## Conflicts and risks

| Conflict | Resolution |
|---|---|
| Sessions are account-wide JWTs and can't be revoked per device | New `tv_devices` table with its own tokens (above) |
| Gamecast WS is per NFL game; the TV wants per league | Add `live_hub` on top; keep the game WS for the Gamecast screen |
| In-process WS fan-out assumes one backend instance | Fine today (one Railway instance). Redis pub/sub is needed only if we scale out. Documented, not built. |
| Live data is from the **unofficial** ESPN public feed | OK for private league use; **must be licensed** (Sportradar or similar) before Play Store distribution to other leagues. See SECURITY_REQUIREMENTS.md. |
| ESPN fantasy sync uses user cookies | The TV never touches it; it reads our database only |
| Branding | The app is The Weekend, with the hive emblem. Owners Box is only an exploration and is not used. |
