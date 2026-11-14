# Existing System Audit — for The Weekend TV

Audited 2026-11-14 by reading the repository directly (backend, frontend, mobile,
migrations, config). No secrets, env values, or user data are reproduced here.

> **Stale docs warning.** The repo-root `ARCHITECTURE.md` and `PROJECT_STATE.md`
> describe the August 2026 Discord-bot starting point ("no HTTP API exists").
> `AGENTS.md` describes a Base44 docker-compose setup that is no longer used. Neither
> matches today's code. Trust this file and the code over those.

## Summary

The Weekend is a mature, three-client
fantasy platform: one FastAPI backend, one Postgres database, a Next.js website and
an Expo (React Native) iOS/Android app. Almost all the data The Weekend TV needs
already exists behind authenticated endpoints. A TV app is mostly a **new client**,
plus a small set of new backend pieces: device pairing, TV-scoped sessions, a public
league mode, and a league-level live stream.

## 1. Frontend

| Client | Stack | Where |
|---|---|---|
| Website | Next.js 16.3.1 (App Router, Turbopack), React 19.2.8, Tailwind 4 | `frontend/`, hosted on Vercel |
| Phone app | Expo SDK 57, React Native 0.86.3, React 19.2.3, expo-router | `mobile/`, built with EAS; OTA updates on channel `main` |

The phone app already has an Android build profile (`eas.json` `preview` → APK).
There is **no** TV client, no Kotlin code, and no Android SDK/JDK on the dev Mac today.

## 2. Backend

One Python 3.13 FastAPI monolith (`backend/app`), hosted on Railway.

- `routers/` (~40 files) are thin HTTP/WebSocket handlers.
- `domain/` (~110 modules) is pure business logic: asyncpg connection or plain data
  in, dicts out. This is where scoring, playoffs, odds, awards, power rankings,
  rivalries, recaps and bets live.
- `queries/` holds raw SQL.
- `providers/` holds outside data sources (ESPN, Sleeper, the NFL feeds, Anthropic,
  bet-slip readers, storage).
- `scheduler.py` runs in-process jobs, each behind an `ENABLE_*` flag, with a
  lease (`scheduler_lease.py`) so only one instance runs them.

## 3. Database

PostgreSQL (Supabase-hosted) through asyncpg. There is no ORM. 149 hand-written
Alembic migrations live in `backend/migrations/versions`. Railway deploys do **not**
run migrations; prod migrations are applied by hand.

Core tables used here include users, owners, leagues and membership, seasons and
teams, matchups, rosters, `player_week_stats` (computed fantasy points),
`league_scoring_rules`, `matchup_narratives` (cached AI write-ups), `share_links`,
bets, chat and Commish Corner, and the push-token tables (`native_push_tokens`,
`user_push_tokens`, `push_subscriptions`).

## 4. Authentication and sessions

- Sign-in options: email/password, Discord, Google and Apple.
- The session is an HS256 JWT valid for 30 days. The website gets it in an httpOnly
  cookie (proxied through `/api/backend/*`). The phone app sends it as
  `Authorization: Bearer`.
- Revocation: `users.token_version` (checked in middleware) revokes **every** session
  an account has at once. There is no per-device session table.
- Short-lived "tickets" (60 seconds to 6 hours) cover WebSocket handshakes and
  uploads (`auth/session.py`).
- Permissions are checked server-side with `require_member_of`,
  `require_commissioner_of`, `require_site_admin` and `resolve_active_league_id`
  (`auth/league_context.py`).
- Rate limiting is in-process (`auth/rate_limit.py`) and covers login, signup and
  password reset only.

## 5. API surface (relevant groups)

| Area | Examples |
|---|---|
| League | `/seasons/{s}/standings`, `/weeks/{w}/matchups`, `/playoffs/bracket`, `/playoffs/odds`, `/playoffs/projected`, `/playoffs/world`, `/records`, `/power-rankings/*`, `/matchups/{id}`, `/win-prob-history`, `/activity` |
| Awards and recaps | `/seasons/{s}/awards`, `/weeks/{w}/awards`, `/weeks/{w}/recap`, `/awards/all-time`, draft grades |
| Gamecast | `/live-games`, `/games/{id}`, `/timeline`, `/boxscore`, `/fantasy-impact`, `/plays/{id}/fantasy`, WS `/gamecast/ws` |
| NFL | `/nfl/scoreboard`, `/game-day` |
| Bets | `/bets` (personal tracker, slip reader), `/league-bets` board, member records, tail |
| Lounge | `/lounge/rooms*`, Watch Party WS |
| Commish | announcements (Commish Corner), commish tools, kitty, league settings |
| Share | `POST /share`, public `GET /share/{token}` (an existing pattern for public, read-only views) |
| Me and settings | profile, notifications, push |

## 6. Sports data providers

| Provider | Use | Status and terms |
|---|---|---|
| ESPN Fantasy (private, cookie-based, unofficial) | League import and sync | Works, but unofficial and fragile |
| Sleeper API (public) | League import, player database | Works, public API |
| ESPN public scoreboard and summary (unofficial, no key) | Gamecast, live stats feeding the scoring engine, ticker | **Default live feed today.** Undocumented. No license for commercial redistribution. |
| Sportradar | Gamecast provider | Code exists, used only if a key is set. Paid. **Not active.** |
| FFC ADP, projection feeds, game wind | Draft and projections | Active as scheduled |
| Mock provider | Development | `GAMECAST_PROVIDER=mock` |

## 7. Fantasy scoring

This is already implemented and authoritative. `domain/scoring_engine.py`
(`compute_player_points`) applies each league's own `league_scoring_rules` to raw stat
lines. Results land in `player_week_stats.fantasy_points`, so **the same performance
already scores differently in each league**. D/ST tiers, IDP, kickers and custom
rules are covered through rule categories (`scoring_catalog.py`,
`stat_derivations.py`).

Stat corrections are handled: weekly stats are re-derived on every run, and the
settlement job waits a day before settling. Gamecast's fantasy deltas are diffs of
engine output, not a second scoring path.

## 8. Data structures

League → seasons → teams (owners/managers) → matchups by week → rosters → players
(Sleeper IDs as the stable key). Leagues carry their own scoring rules, roster slots,
playoff `bracket_spec`, waiver and keeper settings, and mode (redraft, keeper,
guillotine, best ball).

## 9. Real-time

| Mechanism | Shape |
|---|---|
| Gamecast WS | **Per NFL game.** The backend polls the provider once and fans out to every subscriber (in-process dict, no Redis). Holds 5 minutes of history for stream-delay sync. |
| Chat, Draft, Watch Party, Punishment Wheel WS | Per room or conversation |
| Push | APNs, FCM, web push, iOS Live Activities |

What's missing: a **per-league** live channel for matchup scores. Clients refetch
matchups today.

## 10. AI

Anthropic is used server-side only.

- `narrative_engine.py` writes previews and recaps from verified fact payloads and
  caches them once per matchup per state.
- `recap_release.py` and `recap_context.py` build and release the weekly recap.
- Also: chug roast, the bet-slip reader (Haiku first, cached), the error explainer
  and moderation.
- `ai_usage.py` tracks spend.
- Every AI feature degrades to "nothing" when no key is set.

## 11. Betting

Tracking only, with no money movement:

- `bets.py`: a personal sportsbook-slip tracker that grades bets automatically from
  box scores.
- `league_bets.py`: a league board ranked in units, so stakes stay hidden, with
  records, streaks and tails.
- Sharing a bet is limited to the bettor.
- **Kitty** (`kitty.py`): the commissioner's ledger of real dues owed. This is
  private and must never reach a public TV.

## 12. Hosting

- Backend: Railway (single service). Deploys cause about 15–20 seconds of 502s.
- Website: Vercel.
- Database: Supabase Postgres.
- Phone app: EAS Build, App Store, and EAS Update for OTA.

## 13. Security architecture

- All permission checks run on the server.
- ESPN credentials are encrypted at rest (`encryption.py`).
- There are admin-only routes, content moderation, and session revocation by
  `token_version`.
- See `ADMIN_SECURITY.md`.

## 14. Build and deploy

- Pushing to `main` deploys the backend (Railway) and the website (Vercel).
- The phone app ships through EAS builds and OTA.
- Backend tests are pytest (about 170 files). `backend/.env` points at **prod**, so
  every test run must be gated on a localhost `DATABASE_URL`.

## Feature status versus the TV brief

| TV need | Status |
|---|---|
| League, matchups, standings, records, power rankings, awards | **Implemented** (reuse) |
| League-specific scoring and stat corrections | **Implemented** (reuse; do not duplicate) |
| Win probability (normal model) and playoff odds (Monte Carlo + bracket) | **Implemented** (reuse) |
| "Clinched" vs "mathematically possible" labels | **Partial**: odds plus `playoffs.py` clinch logic exist; needs exposing as explicit labels |
| Gamecast (field, drives, plays, fantasy impact) | **Implemented** on phone and web; data is from the unofficial ESPN feed |
| AI recaps and previews | **Implemented** (cached) |
| Commissioner announcements | **Implemented** (Commish Corner, scheduled posts) |
| League bets board | **Implemented** |
| Transactions and activity feed | **Implemented** (`/activity`, trades, waivers) |
| Rivalries | **Implemented** (`rivalry_detection.py`) |
| TV device pairing, device sessions, per-device revoke | **Not built** |
| Public league mode | **Not built** (only per-item public share links) |
| Per-league live score stream | **Not built** |
| AI broadcast commentary for scoring events | **Not built** |
| TV client | **Not built** |
