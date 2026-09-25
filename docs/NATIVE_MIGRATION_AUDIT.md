# Native Migration Audit — Better Fantasy App ("Weekend League")

Phase 0 audit only. **No code was changed to produce this document.** Scope: assess what
it would take to build a production iOS/Android app (React Native/Expo) either
alongside or in place of the existing production web app. Findings are based on direct
inspection of the repository as it exists today (2026-09-21), cross-checked against the
existing `ARCHITECTURE.md`, `MIGRATION_MAP.md`, `PROJECT_STATE.md`, `DEVELOPMENT.md`,
`SCORING_ENGINE_SOURCE.md`, `ESPN_LINEUP_WRITE.md`, `ADMIN_SECURITY.md`, and
`ADMIN_DASHBOARD.md` docs already in this repo.

**Important framing correction up front:** the repo's own historical docs
(`ARCHITECTURE.md`, `MIGRATION_MAP.md`, `PROJECT_STATE.md`) describe an *earlier*
migration — from a Discord bot (`Fantasy_Helper`) to this web app (`Better_Fantasy_App`).
That migration already happened and is largely complete; the app today is a mature
Next.js + FastAPI product, not the "Phase 1 skeleton" those older docs describe. This
audit is about a *different, later* migration: web → native mobile. Treat this document,
not the older ones, as current truth for that question.

---

## 1. Executive summary

Weekend League is a live, actively-used fantasy football companion web app (Next.js 16 /
React 19 frontend, FastAPI/Python backend, Postgres). It already ships to app stores
today via **Capacitor**, which wraps the live production website
(`https://weekend-league-web.vercel.app`) in a native WebView shell — this is **not**
React Native and has none of a true native app's UI, but it is a real, working,
already-shipped "native app" in the App Store/Play Store sense. Any conversation about
"going native" needs to start from that fact, not from zero.

The headline finding, and the single biggest reason this migration is more tractable
than it might look: **the backend was already deliberately prepared for a native
client.** Bearer-token authentication (`Authorization: Bearer <token>`) is implemented
in `backend/app/auth/session.py` with a code comment stating it was added specifically
"for a native client (iOS/Android — no shared cookie jar)." Login/signup already return
the raw token in the JSON body for exactly this purpose. All ~180 REST routes and 3
WebSocket endpoints are clean JSON/WS, with zero server-rendered-HTML dependency. Domain
logic (scoring, matchups, drafts, waivers) lives entirely server-side behind the API.
Provider secrets (ESPN cookies, LiveKit keys, Sportradar keys) never touch any client.

The one clear gap requiring **new backend work** is push notifications, which today are
Web Push (VAPID) only and have no path to APNs/FCM. The one clear gap requiring
**new native client work across the board** is the entire UI/rendering layer: Next.js,
React DOM, Tailwind CSS, and all DOM-dependent interactions (theme system, clipboard
paste, canvas image cropping, drag-and-drop home-card reordering) have zero portability
to React Native and must be rebuilt from scratch against Expo/RN primitives. The
*business logic* behind that UI (the large `src/lib/api.ts` typed fetch layer, WebSocket
protocols, draft/chat/gamecast state machines) is mostly framework-agnostic TypeScript
and is reusable with light adaptation.

**Bottom line:** this is a real, substantial rewrite of the client — not a "wrap it and
ship it" project (that already exists, via Capacitor) — but it is a rewrite with an
unusually solid, already-native-aware backend underneath it, which meaningfully reduces
risk on the hardest-to-get-right parts (auth, data correctness, business rules).

---

## 2. Current architecture

```
                    ┌─────────────────────────────┐
                    │   PostgreSQL (Postgres 16)   │
                    └───────────────▲──────────────┘
                                    │ asyncpg (exclusively — no side-channel
                                    │ readers found anywhere in the repo)
                    ┌───────────────┴──────────────┐
                    │   FastAPI backend (Python)    │
                    │   backend/app/                │
                    │   - ~180 REST routes, 3 WS     │
                    │   - domain/ (scoring, drafts,  │
                    │     waivers, awards — server-  │
                    │     side only)                 │
                    │   - providers/ (ESPN, Sleeper, │
                    │     Sportradar — server secrets│
                    │     only, invisible to clients)│
                    │   - auth/ (JWT + bearer, ready │
                    │     for native)                │
                    └──┬─────────────────────────┬───┘
                       │ HTTP/JSON, WS            │
          ┌────────────▼───────────┐   ┌──────────▼─────────────┐
          │  Next.js 16 frontend    │   │  (future) React Native │
          │  (Vercel)               │   │  / Expo app             │
          │  - App Router, SSR      │   │  - does not exist yet   │
          │  - cookie-based session │   │  - would use the        │
          │  - api/backend proxy    │   │    bearer-token path    │
          └────────────┬────────────┘   └─────────────────────────┘
                       │ wrapped as-is (server.url, no bundled build)
          ┌────────────▼────────────┐
          │  Capacitor WebView shell │  ← TODAY'S "native app"
          │  (frontend/ios,          │     Not React Native.
          │   frontend/android,      │     Ships the same SSR site
          │   committed to git)      │     in a native shell.
          └─────────────────────────┘
```

Both the web frontend and the future native app would be peer HTTP/WS clients of the
same FastAPI backend. No logic needs to move out of the backend for a native client to
work — that is already the API's job.

---

## 3. Current technology stack

| Layer | Technology |
|---|---|
| Frontend framework | Next.js 16.3.1 (App Router, Turbopack), React 19.2.8 |
| Styling | Tailwind CSS 4, custom-property theming system (`globals.css`) |
| Frontend real-time | Native `WebSocket` (chat, draft, gamecast, presence — 4 independent sockets), LiveKit (watch party audio/video) |
| Frontend drag-and-drop | `@dnd-kit` (2 usages only: home dashboard card order, bottom-nav order) |
| Existing "native" wrapper | Capacitor 8 (`@capacitor/core`, `/ios`, `/android` — WebView shell, not RN) |
| Backend framework | FastAPI 0.141.1 (Python 3.13), uvicorn |
| Backend DB access | asyncpg (raw SQL, no ORM), Alembic migrations (78 migration files) |
| Auth | JWT (HS256, pyjwt) + bcrypt; cookie **and** Bearer-header support already built |
| Fantasy data providers | `espn_api` (ESPN, cookie-based for ingestion; public/keyless scoring source), Sleeper (public/keyless), Sportradar (Gamecast, optional) |
| Scheduling | APScheduler (in-process) |
| AI | Anthropic Claude (`claude-sonnet-5`) — weekly narrative recaps only, server-side, deterministic facts in / prose out |
| Realtime video/voice | LiveKit (Watch Party) |
| Push notifications | `pywebpush` — **Web Push / VAPID only**, no native path yet |
| File storage | Vercel Blob (chat images, league logos), S3-compatible bucket (Chug videos) |
| Deployment | Frontend: Vercel (zero-config, no `vercel.json`). Backend: implied Railway (env vars reference Railway-style config; not directly confirmed in-repo). No CI pipeline exists anywhere in the repo. |
| Testing | Backend: 89 pytest files, broad coverage, `pytest.ini` configured, not run in any CI. Frontend: Playwright is an installed-but-unused devDependency — no actual test suite exists. |

---

## 4. Current application features

Grouped by domain, from the route/API surface:

- **Core league operations**: standings, matchups, playoffs, power rankings, rivalries,
  seasons/history, awards (season + all-time), rules.
- **Team management**: roster/lineup view and edit, free agents, waivers, trades,
  keepers, "my team" week view.
- **Draft**: live draft room (queue, picks, schedule, roster slots) over WebSocket.
- **Live game tracking ("Gamecast")**: play-by-play and fantasy-impact feed, WebSocket +
  REST fallback, Sportradar-backed with a mock/simulation fallback when unconfigured.
- **Social**: league chat (WebSocket, typing indicators, read receipts, GIF picker,
  image paste-upload), "Watch Party" (LiveKit group audio/video call with in-call chat),
  presence (site-wide online/offline).
- **Commissioner/admin tools**: league settings, scoring-rule config, playoff settings,
  member management, lineup overrides, a full admin analytics dashboard (see
  `ADMIN_DASHBOARD.md`).
- **"Chug" analyzer**: a league drinking-game feature — video upload, server-side
  computer-vision scoring (pose + audio analysis), leaderboard, debt tracking.
- **Notifications**: web push for game/league events.
- **Auth/onboarding**: email/password, Discord OAuth (existing league members only),
  Google OAuth (self-serve), password reset via email, league invite/claim flow.
- **Marketing/public pages**: welcome, commissioners landing page.

## 5. Current navigation map

Next.js App Router route groups (no shared logic between groups beyond a common root
layout):

- **`(app)`** — the authenticated app shell (~30 pages): activity, admin/*, chug,
  commissioner/* (league/members/polls/roster/scoring/teams/trades), draft, free
  agents, gamecast(+ game detail), history, keepers, league, leagues, matchups(+
  detail), more, owners(+ detail), players, power-rankings, rivalries, rules, seasons(+
  awards/draft), settings, standings, team, teams(+ detail), trades, login/forgot/reset
  password.
- **`(chat)/chat`** — same chrome, minus the ticker bar, for a taller chat viewport.
- **`(home)`** — the `/` landing/dashboard.
- **`(marketing)`** — public `/welcome`, `/commissioners`.
- **`weekend`** — deliberately outside every route group / shares zero chrome, because
  (per an in-code comment) a client-side pathname check previously leaked
  server-fetched data before the page rendered; the route-group boundary was chosen
  specifically to stop data-fetching, not just chrome, from happening for
  unauthenticated variants of this route.
- **`api/backend/[...path]`, `api/chat/upload`, `api/settings/logo-upload`** — Next
  Route Handlers (auth proxy + uploads), not pages.
- **`auth/{complete,logout,me,ticket}`** — session-cookie plumbing, not user-facing
  pages.

**There is no `middleware.ts` anywhere.** Every auth gate is a per-page server-component
check (`getMe()` + conditional JSX), not a centralized route guard. A native app's
navigation stack should **not** copy this pattern — it should centralize the
authenticated/unauthenticated split once, in the navigator root, rather than repeating
a per-screen check 30 times.

## 6. Current authentication architecture

Four login paths converge on one JWT:

1. **Email/password** — bcrypt-hashed, rate-limited (5/15min per email, 30/15min per IP,
   in-memory).
2. **Discord OAuth** — gated to existing league members only (`owners.discord_user_id`
   must already exist); non-members are rejected.
3. **Google OAuth** — self-serve, no pre-existing membership required.
4. **Forgot/reset password** — email via Resend, 1-hour token, bumps a `token_version`
   column that invalidates every other outstanding session for that user.

**Session token**: HS256 JWT, 30-day expiry, claims include `user_id`, `owner_id`,
`discord_user_id`, `is_commissioner`, `token_version`. A global middleware checks
`token_version` against the DB on every request, giving real, immediate server-side
revocation (not just "clear the cookie and hope").

**The two-domain cookie problem, and how it's solved today:** the FastAPI backend and
Next.js frontend are on different domains (Railway vs. Vercel), so they can't share one
browser cookie directly, and Safari's ITP blocks third-party cookies on cross-site
fetches. The current solution is elaborate and web-specific: OAuth callbacks hand the
token to the browser once via a URL fragment (never sent to a server), a Next.js route
mints the frontend's *own* first-party session cookie from it, and a generic
`api/backend/[...path]` proxy route reads that first-party cookie server-side and
forwards it to the backend on every client-side fetch — specifically to dodge ITP.
WebSocket handshakes and large uploads can't go through that HTTP proxy, so they use a
separate short-lived "ticket" JWT (`POST /auth/ticket`) instead.

**Why this matters for native, and the good news:** a native app has no cookie jar to
work around in the first place, so it doesn't need any of that relay machinery — it can
simply store the JWT in Keychain/Keystore and send it as `Authorization: Bearer <token>`
on every request. **This path already exists server-side** — `get_session_token()`
checks the Bearer header before falling back to the cookie, explicitly for this purpose,
and `/auth/login`/`/auth/signup` already return `{"token": ...}` in the JSON body. What's
*not* built yet: Discord/Google OAuth completion currently assumes a browser page to
land the URL-fragment token on; a native app needs a deep-link/custom-URL-scheme
redirect target (or an in-app browser session) to capture that token instead, and
WebSocket ticket-minting needs to be called with a Bearer header rather than a cookie
(the endpoint itself doesn't care which it receives).

## 7. Current data architecture

- **Database**: PostgreSQL 16, accessed exclusively via `asyncpg` from within
  `backend/app/` (routers, domain, queries) and Alembic migration tooling. No script or
  process outside the FastAPI app reads the DB directly — this is a clean single source
  of truth, good for native reuse (nothing to duplicate).
- **Migrations**: 78 Alembic migration files under `backend/migrations/versions/`. No
  standalone table-by-table schema doc exists beyond the historical `ARCHITECTURE.md`
  schema sketch (which describes the *old* Discord-bot-era schema, now superseded).
- **Domain logic** (`backend/app/domain/`, 40 files): scoring engine, lineup rules,
  matchup/playoff/waiver/trade logic, draft engine, awards/narratives, power rankings,
  Chug scoring. `scoring_engine.py` is confirmed genuinely pure and DB-free
  (`compute_player_points(stat_line, rules)`, no `asyncpg` import). Most *other* domain
  modules take a DB connection directly and mix query code with business logic rather
  than being uniformly pure — still entirely server-side and reusable via the API, just
  not as cleanly separated internally as the scoring engine specifically.
- **No scoring/roster logic is duplicated on the frontend.** The frontend's
  `scoringLabels.ts` only maps codes to display labels, not point formulas.

## 8. Current external integrations

| Integration | Purpose | Client-visible? | Native SDK exists? |
|---|---|---|---|
| ESPN (`espn_api`) | League sync (teams/matchups/rosters), public scoring boxscore source | No — `ESPN_S2`/`ESPN_SWID` are server-only env vars, one operator-managed credential covers the whole league | N/A (server-side only) |
| Sleeper | Public, keyless player-identity data, synced ≤1x/day | No | N/A (server-side only) |
| Sportradar | Live play-by-play for Gamecast (optional; falls back to ESPN public scoreboard or a mock) | No — server-only key | N/A (server-side only) |
| LiveKit | Watch Party group audio/video | Yes — client connects directly to LiveKit's SFU using a short-lived JWT minted by the backend | **Yes** — official iOS/Android/RN SDKs exist; token-issuance pattern ports directly |
| Anthropic (Claude) | Weekly narrative recap generation from deterministic stats | No — server-only | N/A (server-side only) |
| Vercel Blob | Chat image/GIF uploads, league logo uploads | Yes, indirectly — client gets a short-lived upload token from a Next.js route | No native SDK; a native app needs an equivalent presigned-token endpoint (already have the pattern, just needs a native-reachable route) |
| S3-compatible bucket | Chug video storage | Yes, indirectly — same presigned pattern | Same as above |
| GIPHY | Chat GIF picker | Yes — server proxies GIPHY calls | No native-specific concern |
| Resend | Password-reset email | No | N/A |
| pywebpush/VAPID | Web push notifications | Yes — browser-only `PushManager` protocol | **No** — has zero compatibility with native push; needs APNs/FCM added alongside |

## 9. Reusable code inventory

**Reusable as-is (server-side, behind the API — no porting needed at all):**
- Entire FastAPI backend: routers, domain logic, provider adapters, auth, DB access,
  scheduling. A native client is just a new consumer of the exact same API the web
  frontend already uses.
- Bearer-token auth flow (already built for this purpose).
- WebSocket ticket-auth pattern for chat/draft/gamecast/watch-party (protocol-level; the
  native client implements the same handshake against `WebSocket`/native WS libraries).
- LiveKit token-issuance backend logic.

**Reusable with adaptation (framework-agnostic TypeScript, currently living in the
Next.js app but not actually DOM-dependent):**
- `src/lib/api.ts` (~2,645 lines) — the entire typed REST client. Pure `fetch` wrappers,
  no DOM. This is the single largest reusable asset on the frontend side; with new
  auth-header wiring instead of cookie-based helpers, it is close to directly portable
  to a React Native project (as a shared package, or copied and adapted).
- `lib/draftApi.ts`, `lib/gamecastApi.ts`, `lib/tradesApi.ts`, `lib/pollsApi.ts`,
  `lib/leaguesApi.ts`, `lib/rosterSlots.ts`, `lib/scoringLabels.ts`,
  `lib/positionColors.ts`, `lib/gameTime.ts` — same category, pure logic modules.
- WebSocket lifecycle logic in `DraftRoom.tsx`, `ChatApp.tsx`, `GamecastShell.tsx`,
  `PresenceProvider.tsx` — the *protocol handling* (connect, reconnect-with-backoff,
  event dispatch) is portable even though the JSX rendering it drives is not.
- Design tokens (`--wl-*` custom properties in `globals.css`) — not portable as CSS, but
  cleanly enumerable as a shared theme/token data structure for a native design system.

**Shared business logic, native UI required:** the "C" category from the audit
brief — draft pick eligibility/queue ordering, chat read-receipt/typing logic, chug
upload heartbeat-stream parsing — logic is portable, presentation must be rebuilt.

## 10. Web-only code inventory

Everything DOM/browser-API-dependent, with no React Native equivalent as-is:

- Next.js itself: App Router, SSR, Server Components, Route Handlers, `next/image`,
  `next/link` — the entire routing/rendering/data-fetching model is web-specific.
- Tailwind CSS and the custom-property theme system (`globals.css`, 2,175 lines) —
  including CSS that targets Tailwind's own generated dark-mode class names, which has
  no RN analog.
- Cookie-based UI preference storage (`document.cookie` for theme/accent/neon
  intensity/beta layout) — read by an inline boot `<script>` in the root layout to avoid
  flash-of-unstyled-content; needs a native settings-store rewrite.
- `@dnd-kit`-based drag-and-drop (home dashboard card reordering, bottom-nav item
  reordering — 2 components only, not the draft room as might be assumed).
- Canvas-based image cropping (`LogoUploadCropper.tsx`).
- Clipboard-paste image upload in chat (`ClipboardEvent`/`clipboardData.items`).
- `@livekit/components-react` prebuilt web UI components (the underlying LiveKit
  *protocol* is portable via LiveKit's RN SDK; this specific package is not).
- PWA manifest + hand-written service worker (`public/sw.js`) — irrelevant once the app
  is truly native, though its Web Push handling logic documents what a native push
  handler needs to replicate.
- Playwright E2E tests (browser automation; not applicable to native binaries) — moot
  anyway since no actual Playwright test suite exists despite the dependency being
  installed.

## 11. Native-incompatible dependencies

See `docs/NATIVE_MIGRATION_DEPENDENCIES.md` for the full table. Summary of the
consequential ones:

- `next`, `react-dom` — entire rendering/routing layer, full rewrite.
- `tailwindcss` / `@tailwindcss/postcss` — no CSS in RN; replace with NativeWind or
  StyleSheet.
- `@dnd-kit/*` — DOM drag events; replace with `react-native-gesture-handler` +
  `react-native-reanimated` (small surface area — only 2 features use it).
- `@livekit/components-react`, `@livekit/components-styles` — web-only UI; replace with
  `@livekit/react-native` (the protocol/`livekit-client` core is shared, but this
  specific package is not usable).
- `playwright` — not applicable to native; replace with Detox/Maestro if native E2E
  testing is wanted.
- `@capacitor/*` — **not a dependency of an RN migration; it's the alternative to it.**
  Keeping both strategies indefinitely (Capacitor wrapper for a fast-follow release,
  real RN app as the long-term investment) is a legitimate sequencing option, not a
  contradiction — but they are not additive; a full RN app supersedes the Capacitor
  wrapper for whichever platforms it ships on.
- `@vercel/blob` — likely usable from RN with polyfills or by calling its HTTP API
  directly with `fetch` rather than importing the SDK; needs a smoke test before relying
  on it.

Backend Python dependencies are unaffected by the choice of native framework (the
backend is consumed over HTTP regardless) with one exception: `pywebpush` implements a
browser-only protocol and needs a new, additive native push path (APNs/FCM), not a
replacement.

## 12. Native replacement recommendations

| Web thing | Native replacement |
|---|---|
| Next.js App Router | Expo Router (file-based, closest conceptual match) or React Navigation |
| Tailwind CSS | NativeWind (keeps utility-class authoring style) |
| `@dnd-kit` | `react-native-gesture-handler` + `react-native-reanimated`, or `react-native-draggable-flatlist` for the 2 reorder features |
| `@livekit/components-react` | `@livekit/react-native` SDK |
| Web Push (VAPID) | `expo-notifications` client-side; APNs (.p8 key) + FCM server-side, additive to (not replacing) the existing VAPID path for web |
| Cookie-based session | Bearer token in `Authorization` header + Keychain (iOS)/Keystore (Android) secure storage — backend already supports this |
| OAuth URL-fragment landing page | Deep link / custom URL scheme, or `ASWebAuthenticationSession` (iOS) / Chrome Custom Tabs (Android) |
| Canvas image cropping | A native image-crop library (e.g. `expo-image-manipulator` + a crop UI, or a dedicated RN cropper package) |
| Clipboard-paste image upload | `expo-clipboard` + `expo-image-picker` |
| Playwright | Detox or Maestro, if native E2E is prioritized |
| PWA manifest / service worker | N/A — not needed once truly native; its push-handling logic is a useful reference for the native push handler's behavior |

## 13. High-risk areas

Ranked qualitatively; see `docs/NATIVE_MIGRATION_RISKS.md` for the full Critical →
Low ranking with rationale. The standout risks worth flagging here:

1. **Four independent WebSocket features, each hand-rolled** (chat, draft, gamecast,
   presence) with their own reconnect/backoff logic and no shared client library. A
   native rewrite either ports this pattern four times or invests in one shared native
   WS client first — doing it four times independently risks four subtly different
   reconnect bugs.
2. **Push notifications require new backend work**, not just new client work — a second
   subscription-table shape (device tokens, not `p256dh`/`auth` keys) and a second
   dispatch path have to be built and kept in sync with the existing web path.
3. **OAuth completion flow assumes a browser** — this is the one part of the "already
   native-ready" auth story that still needs backend-adjacent design work (a redirect
   target a native app can catch).
4. **ESPN per-owner cookie collection is an open, unresolved design question** (see
   `ESPN_LINEUP_WRITE.md`'s own "open question" section) — if the current
   single-operator-credential model ever needs to become per-owner, a native app would
   need to prompt end users to extract and paste raw ESPN session cookies, which is a
   markedly worse UX on mobile than on web. Not an active problem today, but worth
   flagging before native work starts so it isn't discovered mid-build.
5. **No CI pipeline exists at all** — the 89-file backend pytest suite and any future
   native test suite would both be relying purely on manual `pytest`/`npm test` runs
   before merge. This isn't specific to the native migration, but a native rewrite
   materially raises the cost of an undetected regression (two more app-store review
   cycles instead of an instant redeploy).

## 14. Data/security concerns

- **Provider secrets discipline is good and should be preserved**: ESPN, Sportradar,
  LiveKit, and Anthropic keys are all server-only, several with explicit
  "never place this key in frontend code" comments in the source. A native app must not
  break this by, say, embedding a LiveKit API secret in the app bundle — it should only
  ever receive short-lived tokens, exactly as the web app does today.
- **Cookie domain/SameSite/Secure logic is fragile by nature** (two real production
  bugs already fixed here) — irrelevant to a native app's own auth (which uses Bearer
  tokens), but a reminder that this is delicate code not to disturb while adding native
  support alongside it.
- **Rate limiting is in-memory/per-process only** — an accepted single-instance
  tradeoff today. A native app adds a new traffic source; if traffic growth ever
  motivates horizontally scaling the backend, this would need revisiting regardless of
  native migration, but native migration doesn't change the calculus on its own.
  it.
- **Admin dashboard queries never select credential fields** (password hashes, session
  tokens, push subscription secrets) — enforced by omission today; any new native-facing
  admin surface should preserve that discipline.
- **No security-event/audit logging yet** (disclosed as a known gap in
  `ADMIN_SECURITY.md`) — adding a new client (native) increases the value of having
  this, though it's a pre-existing gap, not one native migration introduces.

## 15. Recommended migration architecture

Keep the backend exactly as-is as the single source of truth for both clients:

```
FastAPI backend (unchanged)
    ├── Web frontend (Next.js, cookie/proxy auth) — stays as-is, keeps shipping via
    │   Vercel + the existing Capacitor WebView wrapper for app-store distribution
    │   in the near term
    └── New: React Native / Expo app — Bearer-token auth, Expo Router, NativeWind,
        native WebSocket client(s) for chat/draft/gamecast/presence, LiveKit RN SDK
        for Watch Party, expo-notifications + new APNs/FCM backend path for push
```

Recommended new backend-side additions (small, additive, non-breaking to the web app):
1. A device-token push subscription table + APNs/FCM dispatch path, alongside (not
   replacing) the existing VAPID path.
2. A native-reachable OAuth completion redirect (deep link/custom scheme) as an
   alternative to the current browser-page landing target.
3. Light analytics-taxonomy extension for screen-based (not route-based) `page_view`
   events, since a native app has no URL bar.

Everything else needed for native — REST API, WS protocols, domain logic, DB, provider
adapters — requires zero backend changes to start consuming from a native client.

## 16. Recommended migration sequence

This is a sequencing recommendation for your review, not a decision already made:

1. **Phase 0 (this document)** — audit complete.
2. **Phase 1 — Backend native-readiness closeout**: implement the three backend
   additions in §15 (push, OAuth deep link, analytics taxonomy). Small, additive,
   testable independently of any native client existing yet.
3. **Phase 2 — Expo project scaffold + auth**: stand up the Expo/RN project, wire
   Bearer-token login (email/password first, since it needs no OAuth redirect work),
   secure token storage, and a minimal authenticated shell (nav + one real screen, e.g.
   standings) to prove the API-reuse thesis end-to-end before investing in UI breadth.
4. **Phase 3 — Read-heavy core screens**: standings, matchups, team/roster view,
   players, history/awards — these are the most REST-shaped, least real-time-dependent
   screens, and share the most reusable `lib/api.ts`-equivalent logic.
5. **Phase 4 — Real-time features**: chat, presence, draft room, gamecast — one shared
   native WebSocket client, built once, then reused across all four, rather than four
   independent implementations.
6. **Phase 5 — Push notifications**: wire `expo-notifications` against the new
   APNs/FCM backend path from Phase 1.
7. **Phase 6 — Watch Party (LiveKit RN SDK)** and **Chug analyzer upload** — treated as
   later phases since they're self-contained features with clear boundaries and
   meaningfully more native-specific integration work (LiveKit RN SDK, camera/video
   picker) than the core app.
8. **Ongoing**: OAuth (Discord/Google) native completion flow can land whenever
   Phase 1's deep-link work is ready — not a hard blocker for earlier phases since
   email/password already works end-to-end.

Deliberately **not** in this sequence, per the audit brief's own scope limits: no
decision here about retiring the Capacitor wrapper, no decision about which platform
(iOS/Android) ships first, no UI/design system decisions.

## 17. Testing requirements

- **Backend**: the existing 89-file pytest suite already covers auth, draft, scoring,
  ESPN integration, gamecast, chat, chug, trades/waivers/keepers, push, polls, power
  rankings, records/awards, playoffs, scheduling, and multi-league isolation. This
  suite should be run against any backend changes made for native-readiness (§15) —
  it is not currently run in CI, so this must be manual until CI exists.
  **No CI exists today for either app** — establishing at least a pre-merge pytest run
  is worth doing before or alongside native backend work, independent of the native
  migration itself.
- **Native app**: needs a testing strategy decided fresh — Detox or Maestro are the
  conventional choices for RN E2E; unit-level testing of the ported `lib/api.ts`-style
  modules can reuse standard Jest/TypeScript tooling shared with (or copied from) the
  web project.
- **Cross-client regression risk**: because both web and native will hit the same
  backend, any backend change made "for native" (e.g. a new push table) needs a
  regression pass against the *existing* web app's pytest coverage before shipping,
  not just new native-specific tests.

## 18. Open questions

These require your decision, not mine, before Phase 1 (backend native-readiness) work
starts:

1. **Capacitor wrapper's future**: keep shipping it in parallel with a native rewrite
   (e.g., for platforms/features not yet ported), or plan to retire it once the RN app
   reaches parity? Not needed for Phase 1, but worth having a stance before Phase 2-3
   UI investment begins.
2. **Push notification service choice**: Expo's push service (simplest, adds a
   dependency on Expo's own relay) vs. calling APNs/FCM directly from the backend (more
   control, more implementation work). Affects the Phase 1 backend design.
3. **ESPN per-owner cookie question** (§13, item 4): still unresolved per
   `ESPN_LINEUP_WRITE.md` itself — worth a decision before it becomes urgent, since the
   native UX implications are worse than the web ones.
4. **Which platform ships first** (iOS, Android, or both simultaneously) — affects
   Phase 2 sequencing and app-store review-cycle planning.
5. **OAuth priority**: is email/password-only acceptable for an initial native release
   (unblocking Phase 2 immediately), or does Discord OAuth (the primary onboarding path
   for existing league members, per §6) need to ship in the first native release,
   pulling the deep-link work into Phase 1?
6. **CI investment**: should establishing a CI pipeline be pulled forward as an
   explicit early native-migration task, given the added regression surface of a second
   client hitting the same backend?
