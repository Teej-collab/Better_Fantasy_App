# BASE44 UI SPECIFICATION

**App:** Weekend League (repository `Better_Fantasy_App`)
**Purpose of this document:** give an AI builder (Base44) everything it needs to rebuild the **frontend only** while continuing to call the **existing FastAPI backend unchanged**.
**Produced by:** reverse-engineering the repository source on 2026-09-26. No application code was changed.
**Evidence rule:** every endpoint, field, and behavior below was read from source (routers, domain modules, `frontend/src/lib/*.ts` types, components). Where layers disagree, both are recorded and the conflict is listed in §27. Anything that could not be verified is marked **UNKNOWN — requires verification**.

Conventions used throughout:

- `BE:` = backend-owned rule. `FE:` = frontend display/interaction responsibility.
- File references are repo-relative, e.g. `backend/app/routers/me.py`.
- TypeScript type names (e.g. `RosterEntry`) refer to the existing definitions in `frontend/src/lib/api.ts` (or the named `*Api.ts` file). They are the most complete, already-validated record of response shapes and should be copied verbatim into the new frontend.

---

## 1. Executive Summary

Weekend League is a private-league fantasy-football companion and management app. It is **not** a thin ESPN viewer anymore: the backend runs its own draft room, roster/lineup engine, waivers, trades, keepers, scoring engine, playoff bracket, power rankings, awards, chat, and a "Chug" drinking-game feature, while ESPN / Sleeper / ESPN-public / Sportradar are used as **server-side data providers**.

Current shape:

| Layer | What exists |
|---|---|
| Frontend | Next.js 16 App Router + React 19 + Tailwind 4, **53 page routes**, 8 Next.js route handlers (auth/cookie plumbing, backend proxy, upload tokens), ~160 components. Dark-only, neon-accent visual identity. Mobile-first with a fixed bottom tab bar; desktop gets a top nav. Shipped to iOS/Android as a **Capacitor WebView shell** that loads the production website. |
| Backend | FastAPI (Python 3.13), asyncpg raw SQL, Alembic (85 migrations), APScheduler jobs. **215 HTTP routes + 4 WebSocket endpoints** across 26 routers. |
| Auth | HS256 JWT session (30-day). Accepted as `session` cookie **or** `Authorization: Bearer <token>` on every HTTP route. WebSockets use a short-lived `?ticket=` JWT. Email/password, Discord OAuth, Google OAuth (built but hidden in UI). Server-side revocation via `users.token_version`. |
| Real-time | 4 WebSocket endpoints (chat+presence, draft room, Gamecast, Watch Party digest) + LiveKit (video/audio) + Web Push (VAPID) + native push (APNs/FCM). |
| Data | PostgreSQL 16, ~75 tables. League scoping is **session-derived** (`users.active_league_id`), never from the URL (except a few `/leagues/{league_id}/…` commissioner routes that re-verify membership). |

**Headline guidance for Base44:**

1. Build screens, navigation, components, and an API client. **Do not** rebuild scoring, lineup legality, waivers, trades, drafts, keepers, playoffs, awards, power rankings, chat persistence, provider integrations, or auth. They exist and are correct server-side.
2. The new frontend cannot reuse the Next.js same-origin proxy (`/api/backend/*`). It must call FastAPI **directly with a Bearer token**. The backend already supports this, but there are three concrete blockers to resolve first (see §27 R1–R3): CORS does not allow `PATCH`, image uploads depend on a Next.js-only Vercel Blob token route, and `CORS_ALLOWED_ORIGINS` must include the Base44 origin.
3. Copy the TypeScript types from `frontend/src/lib/api.ts`, `draftApi.ts`, `gamecastApi.ts`, `tradesApi.ts`, `leaguesApi.ts`, `pollsApi.ts`, `playerCardApi.ts`, `commissionerLineupApi.ts` as the response contracts.

---

## 2. Application Architecture

```
Browser / Capacitor WebView
        │
        ▼
Next.js 16 (Vercel, https://weekend-league-web.vercel.app)
   ├── Server Components: fetch FastAPI directly with Cookie: session=<jwt>   (SSR)
   ├── /api/backend/[...path]  → server-side proxy, forwards the first-party `session` cookie
   ├── /auth/ticket            → proxies POST /auth/ticket (for WS/upload tickets)
   ├── /auth/complete/set-cookie, /auth/logout, /auth/me, /chat/conversations  → cookie plumbing
   └── /api/chat/upload, /api/settings/logo-upload → Vercel Blob client-upload tokens
        │
        ▼  HTTPS JSON  +  WSS (direct to backend, ticket in query string)
FastAPI (backend/app/main.py; implied Railway hosting — not confirmed in repo)
   ├── middleware: session_revocation (token_version check), security_headers, CORS
   ├── routers/   (26 routers, HTTP + WS)
   ├── domain/    (business rules: lineup, waivers, trades, draft, scoring, playoffs, awards …)
   ├── queries/   (raw asyncpg SQL)
   ├── providers/ (ESPN private+public, Sleeper, Sportradar, Anthropic, GIPHY, S3 chug storage)
   ├── chat/ draft/ gamecast/ watch_party/  (in-process WebSocket connection managers)
   ├── notifications/ (Web Push VAPID, APNs, FCM, Resend email)
   └── scheduler.py (APScheduler; every job behind an ENABLE_* flag)
        │
        ▼
PostgreSQL 16
```

Key architectural facts that shape the rebuild:

- **Single-process in-memory state**: WebSocket connection managers, presence, rate limiting, and the Gamecast cache are in-process (`backend/app/chat/manager.py`, `draft/manager.py`, `gamecast/manager.py`, `watch_party/manager.py`, `auth/rate_limit.py`). The frontend must tolerate reconnects that lose in-memory presence.
- **No `middleware.ts` in the frontend.** Every page does its own `getMe()` check and renders `SignInCard` / `NeedsLeagueCard` / a "not authorized" paragraph.
- **League context is implicit.** Almost every league data call is scoped to the caller's `active_league_id` stored server-side. Switching leagues = `POST /leagues/{id}/select` then re-fetch everything.
- **Season is implicit on many routes.** Backend reads `ACTIVE_SEASON` env for My Team, draft, keepers, trades, chat members, etc. The frontend derives the "latest season" from `GET /seasons` (max value) for season-parameterized routes.

---

## 3. Technology Stack

| Area | Technology (verified) | Source |
|---|---|---|
| Frontend framework | Next.js 16.3.1 (App Router, Turbopack), React 19.2.8 | `frontend/package.json` |
| Styling | Tailwind CSS 4 (`@tailwindcss/postcss`), one global stylesheet `frontend/src/app/globals.css` (2,175 lines) with CSS custom-property tokens | `globals.css` |
| Fonts | `next/font/google`: IBM Plex Sans (`--font-body`), Oswald (`--font-display`), Geist Mono (`--font-geist-mono`); Broadcast direction: Bebas Neue, Source Sans 3, JetBrains Mono; Stadium direction: Space Grotesk, Space Mono | `frontend/src/app/layout.tsx` |
| Drag & drop | `@dnd-kit/core`, `/sortable`, `/utilities` (home card reorder, nav reorder) | `HomeCardDeck.tsx`, `NavigationSection.tsx` |
| Video/audio | `livekit-client`, `@livekit/components-react`, `@livekit/components-styles` | `WatchPartyRoom.tsx`, `LoungeVideoRoom.tsx` |
| Uploads | `@vercel/blob` (client `upload()` + server `handleUpload`) | `MessageComposer.tsx`, `LogoUploadCropper.tsx`, `FeedbackSection.tsx` |
| Native shell | Capacitor 8 (`@capacitor/core`, `ios`, `android`, `device`, `push-notifications`); `server.url` = production site | `frontend/capacitor.config.ts` |
| PWA | `public/manifest.json`, hand-written `public/sw.js` (network-first cache of `/api/backend/*` GETs, push + notificationclick handlers) | `public/sw.js` |
| Frontend tests | None (Playwright installed, unused) | `package.json` |
| Backend | FastAPI, uvicorn, asyncpg, Alembic, APScheduler, pyjwt, bcrypt, pywebpush, httpx, `espn_api` | `backend/requirements.txt` |
| Backend tests | 108 files under `backend/tests/` (pytest) | repo |
| Database | PostgreSQL 16 | `docker-compose.base44.yml` |
| CI | None found | repo |

---

## 4. Frontend Architecture

### 4.1 Directory layout

```
frontend/src/
├── app/                       Next.js App Router
│   ├── layout.tsx             root: fonts, appearance boot script, OfflineBanner, PageViewTracker,
│   │                          PresenceProvider, PlayerCardProvider, ServiceWorkerRegistration,
│   │                          NativePushRegistration, AudioWarmup
│   ├── (home)/                "/" dashboard (NavBar + PullToRefresh + PageShell, NO ticker bar)
│   ├── (app)/                 ~48 app pages (NavBar + AppTickerBar + PullToRefresh + AppEntry + PageShell)
│   ├── (chat)/chat/           chat (NavBar, no ticker bar, full-height)
│   ├── (marketing)/           /welcome, /commissioners (no app chrome)
│   ├── weekend/               /weekend (no chrome, neon landing)
│   ├── lounge/[slug]/         public lounge join page (no chrome)
│   ├── auth/                  complete, native-complete (pages); set-cookie, logout, me, ticket (route handlers)
│   ├── api/                   backend proxy + upload-token route handlers
│   ├── chat/conversations/    route handler (unread count)
│   ├── not-found.tsx, error.tsx, global-error.tsx, globals.css
├── components/                ~160 components (nav/, chat/, draft/, gamecast/, matchups/, settings/,
│                              commissioner/, admin/, watchparty/, lounge/, players/, standings/, marketing/)
└── lib/                       typed API clients + pure helpers + hooks
```

### 4.2 Data-fetching patterns (current)

| Pattern | Where | How |
|---|---|---|
| SSR, authenticated | Most pages (Server Components) | `fetch(API_BASE_URL + path, { headers: { Cookie: "session=<cookie>" }, cache: "no-store" })` via `getServer` / `getServerOrNull` in `lib/api.ts`. `getServerOrNull` maps 401/403/404/409 → `null`. |
| SSR, public | `/seasons`, `/seasons/{s}/current-week`, `/nfl/scoreboard`, `/nfl/live-games`, `/nfl/games/{id}`, `/chug/seasons`, `/free-agents/waiver-settings`, `/lounge/rooms/{slug}` | plain `fetch` with no cookie (`get()` in `lib/api.ts`) |
| Client, authenticated | Client components | `fetch("/api/backend" + path)` → Next proxy adds cookie server-side |
| Client, WS/upload tickets | Chat, draft, gamecast, watch party, chug upload | `POST /auth/ticket?purpose=…` (Next route) → returns `{ ticket }` |
| Refresh after mutation | many | either local state patch from the mutation response, a component `refresh()` re-fetch, or `router.refresh()` (re-runs Server Components) |
| Live refresh | Home + ticker bar during live NFL games | `GameDayRefresher` → `router.refresh()` every 45 s while tab visible |

**For Base44:** replace all of this with one API client that (a) prefixes the backend base URL, (b) sends `Authorization: Bearer <token>`, (c) parses `{ detail }` error bodies (string, or object for a few routes — §17), and (d) exposes the same function names/types as `lib/*.ts` to minimize translation.

### 4.3 Client-side persistence (current)

| Key | Storage | Purpose | Set by |
|---|---|---|---|
| `session` | httpOnly cookie (frontend origin) | JWT | `/auth/complete/set-cookie` |
| `wl_neon`, `wl_motion`, `wl_accent`, `wl_your_week_color`, `wl_border_color`, `wl_theme`, `wl_beta_layout`, `wl_direction` | non-httpOnly cookies | mirror of appearance prefs so the root inline script can apply them before first paint (`data-neon`, `motion-reduced` class, `--user-accent`, `--your-week-color`, `--border-glow-color`, `data-wl-theme`, `data-wl-layout`, `data-wl-direction`) | Settings › Appearance / Labs |
| `wl_intro_seen` | localStorage | skip the animated intro after first view | `useWeekendIntro.ts` |
| `wl_session_id` | sessionStorage | analytics session id | `analyticsEvents.ts` |
| `wl-api-cache-v1` | Cache Storage (SW) | offline fallback for `/api/backend/*` GETs, max 60 entries | `public/sw.js` |

Server-side source of truth for all appearance prefs is `GET/PUT /settings/preferences` (§11.14).

---

## 5. Backend Architecture Relevant to Frontend

### 5.1 Router inventory (`backend/app/main.py` include order)

| Router file | Prefix | # routes | Frontend relevance |
|---|---|---|---|
| `admin.py` | `/admin` | 29 | Admin dashboard (read) + analytics `track`; 11 ops triggers not used by UI |
| `admin_lineup.py` | `/admin/lineup` | 3 | ESPN lineup-write tools; **not used by UI** |
| `auth.py` | `/auth` | 13 | Login/signup/OAuth/tickets/logout/account delete |
| `awards.py` | (none) | 7 | Season/weekly awards, draft grades, weekly recap |
| `chat.py` | `/chat` | 9 + WS | Chat |
| `chug.py` | `/chug` | 10 | Chug leaderboard/feed/upload/commissioner actions |
| `commissioner_lineup.py` | `/leagues` | 5 | Commissioner force-edit roster |
| `draft.py` | `/draft` | 22 + WS | Draft room + setup |
| `feedback.py` | `/feedback` | 2 | Feedback submit/list |
| `free_agents.py` | `/free-agents` | 1 | Waiver settings (FAAB vs priority) |
| `game_day.py` | (none) | 1 | `/game-day` — **not used by UI** |
| `gamecast.py` | `/nfl` | 3 + WS | Gamecast |
| `keepers.py` | `/keepers` | 6 | Keepers |
| `league.py` | (none) | 22 | Standings, matchups, rosters, power rankings, records, rivalries |
| `league_settings.py` | `/league` | 9 | Scoring rules, playoff settings, ESPN connection |
| `leagues.py` | `/leagues` | 16 | Multi-league membership, teams, co-owners |
| `lounge.py` | `/lounge` | 5 | Public password video rooms |
| `me.py` | `/me` | 13 | Your Week, My Team, lineup, free agents, waivers |
| `nfl.py` | `/nfl` | 1 | ESPN public scoreboard |
| `players.py` | `/players` | 2 | NFL player list/card |
| `polls.py` | `/leagues` | 4 | League polls |
| `profile.py` | (none) | 4 | Owner profiles |
| `push.py` | `/push` | 6 | Web + native push |
| `settings.py` | `/settings` | 10 | Profile + preferences |
| `trades.py` | `/trades` | 11 | Trades |
| `watch_party.py` | `/watch-party` | 5 + WS | Watch Party rooms |
| `main.py` | — | 1 | `GET /health` |

### 5.2 Cross-cutting backend behavior the UI depends on

- **Session revocation middleware** (`main.py`): any request (except `/auth/{discord,google}/{login,callback}`, `/auth/login`, `/auth/signup`, `/auth/logout`) carrying a validly-signed token whose `token_version` no longer matches `users.token_version` (or whose user was deleted) gets `401 {"detail":"Session expired or invalid"}`. Logout and password reset bump `token_version`, so **all devices are signed out**.
- **Security headers**: `X-Frame-Options: DENY` on every backend response (and on the Next frontend via `next.config.ts`). Relevant if Base44 previews embed the app in an iframe (see §27).
- **CORS**: `allow_origins = CORS_ALLOWED_ORIGINS.split(",")`, `allow_methods = ["GET","POST","PUT","DELETE"]` (**no PATCH**), `allow_headers=["*"]`, `allow_credentials=True`.
- **ACTIVE_SEASON** env var drives "current season" for `/me/*`, `/draft/*`, `/keepers/*`, `/trades/*`, `/chat/members`, `/players*`, `/settings/*`, `/league/playoff-settings`, `/chug/*`, commissioner roster routes. `/seasons` (distinct seasons with synced teams) drives season tabs.
- **DEFAULT_LEAGUE_ID = 1** (`backend/app/config.py`): League #1's commissioner is implicitly a site admin; several ops routes only work for League #1.
- **Schedulers** (`backend/app/scheduler.py`), all off unless `ENABLE_*=true`: ESPN full sync, live sync (60 s), week settlement (Tuesday 2 PM CT flip; power-rank lock; auto recap), Gamecast poll (4 s, only while someone is connected), Watch Party poll (30 s), Sleeper player sync, draft clock (2 s autopick, auto-start, room-open, grades), keeper auto-lock, weekly compute, waiver processing (hourly). **UI implication:** in a dev/preview backend with schedulers off, live scores, draft clock autopick, and waiver processing will not advance on their own.

---

## 6. Authentication

### 6.1 Token model (`backend/app/auth/session.py`)

- Session token: HS256 JWT signed with `SESSION_SECRET`, 30-day `exp`. Claims: `user_id`, `owner_id` (nullable, **may be stale**), `discord_user_id` (nullable), `is_commissioner` (legacy, not trusted server-side for authz), `token_version`.
- Accepted on HTTP routes via `get_session_token(request)`: `Authorization: Bearer <token>` **wins over** the `session` cookie.
- Ticket token: same secret, adds `purpose` claim, short expiry. Purposes: `ws` (60 s), `chug_upload` (15 min), `watch_party_ws` (6 h), `native_oauth` (60 s, single-use via `jti` in `used_oauth_tickets`). A ticket can never be used as a session and vice versa.

### 6.2 Flows

| Flow | Steps (verified) | Endpoints |
|---|---|---|
| Email sign-up | Form (display name, email, password, confirm) → `POST /auth/signup` → `{token}` (also sets backend-domain cookie) → web: `POST /auth/complete/set-cookie {token}` (Next route) → navigate `/` (or `/leagues#join-league` / `#create-league` for intent variants) | `POST /auth/signup` |
| Email sign-in | `POST /auth/login` → `{token}` → same as above | `POST /auth/login` |
| Discord OAuth | Link (opens in **new tab**, `target="_blank"`) to `{API}/auth/discord/login[?client=native]` → Discord → `GET /auth/discord/callback` → web: redirect to `{FRONTEND_URL}/auth/complete#token=<jwt>` → page posts token to `/auth/complete/set-cookie` → `/`. Non-member Discord account → `{FRONTEND_URL}/login?error=not_a_league_member`. | `GET /auth/discord/login`, `/auth/discord/callback` |
| Native OAuth | `?client=native` → callback redirects to `{NATIVE_APP_UNIVERSAL_LINK_BASE or FRONTEND_URL}/auth/native-complete?ticket=…` (or `?error=not_a_league_member`) → page calls `POST /auth/native/redeem {ticket}` → `{token}` | `POST /auth/native/redeem` |
| Google OAuth | Fully built server-side (`/auth/google/login`, `/auth/google/callback`, self-serve, no membership check) but **the button is hidden** in `SignInCard.tsx` (no credentials configured) | — |
| Forgot password | `POST /auth/forgot-password {email}` → always `{message}` (generic, or "This account signs in with Discord or Google…" for passwordless accounts); email link `{FRONTEND_URL}/reset-password?token=…` (Resend) | |
| Reset password | `POST /auth/reset-password {token,new_password}` (min 8 chars) → `{message}`; bumps token_version (signs out everywhere) | |
| Session check | `GET /auth/me` → `Me` | |
| Logout | `clearSession()` fires **both** `POST {API}/auth/logout` (credentials: include; bumps token_version, deletes backend cookie, 204) and `POST /auth/logout` (Next route, clears frontend cookie), deletes SW cache, then `router.push("/")` + `router.refresh()` | `POST /auth/logout` |
| Delete account | Settings › Account › `DELETE /auth/me` → 204; 409 if user created a league or is a league's sole commissioner (detail string explains) | `DELETE /auth/me` |
| WS / upload ticket | `POST /auth/ticket?purpose=ws\|chug_upload\|watch_party_ws` → `{ticket}` | |
| Co-owner join | `/join-co-owner?code=…` → `POST /leagues/co-owner-invites/redeem {invite_code}` → `{owner_id, token}` → **must replace the stored session token** with the returned one | |
| Claim historical owner | `POST /leagues/{id}/claim-owner {owner_id}` → `{owner_id, claimed, token}` → **must replace stored token** | |

Rate limits (in-memory, per process, `backend/app/auth/rate_limit.py`): login, signup, and forgot-password allow 5 attempts per email and 30 per IP per 15 minutes; exceeding returns `429 {"detail":"Too many attempts — try again later"}`. The UI shows `detail` verbatim.

### 6.3 `Me` shape (`GET /auth/me`)

```json
{ "user_id": 12, "owner_id": 7, "display_name": "TJ",
  "is_commissioner": true, "is_site_owner": true, "active_league_id": 1 }
```
- `owner_id`: **nullable** (league-less signup). The TS type says `number` — discrepancy, treat as `number | null`.
- `is_commissioner`: live check — commissioner of the **active** league.
- `is_site_owner`: League #1 commissioner OR `users.is_admin`. Gates Admin UI.
- `active_league_id`: `null` → user must go to `/leagues` (UI shows `NeedsLeagueCard`).

### 6.4 Authorization levels (use these labels everywhere in this spec)

| Label | Backend check | Failure |
|---|---|---|
| **Public** | none | — |
| **Session** | valid session token | 401 `Not signed in` / `Session expired or invalid` |
| **ActiveLeague** | Session + `users.active_league_id` set (`require_active_league_id`) | 409 `No active league selected` |
| **LeagueRead** | `Depends(require_league_access)` = Session + ActiveLeague | 401 / 409 |
| **HasTeam** | ActiveLeague + a `teams_by_season` row for (ACTIVE_SEASON, owner, league) | 404 `No team found for this owner` |
| **MemberOf(path)** | membership in the `{league_id}` in the URL | 403 |
| **CommishOf(path)** | role `commissioner` in the `{league_id}` in the URL | 403 `Commissioner only` |
| **ActiveCommish** | commissioner of the active league (`require_league_commissioner`) | 409 / 403 |
| **League1Commish** | commissioner of League #1 | 403 |
| **SiteAdmin** | League #1 commissioner OR `users.is_admin` | 403 `Admin only` |
| **Ticket(purpose)** | `?ticket=` JWT of that purpose (or session cookie) | WS close 4401 / HTTP 401 |

Roles that exist in data: league `role ∈ {commissioner, member}` (`league_members`). **"Co-commissioner" is not a distinct role** — a league can have multiple members with role `commissioner`. **Co-owner** = a second user linked to the same owner/team via `owner_users` (co-owner invite). There is no separate "owner" role beyond "user linked to an owner row that has a team".

### 6.5 Route protection (current frontend)

No central guard. Each page: `getMe()` → `null` ⇒ render `<SignInCard/>`; `active_league_id === null` ⇒ `<NeedsLeagueCard/>`; commissioner pages additionally check `me.is_commissioner` and render "Commissioner tools are only visible to your league's commissioner."; `/admin/*` layout checks `me.is_site_owner` ⇒ "Not authorized." **Base44 should centralize this** in a route guard with the same three outcomes.

### 6.6 Native/mobile readiness (already built)

- Bearer tokens on every HTTP route; `/auth/login`, `/auth/signup`, `/auth/native/redeem` return `{token}` in JSON.
- OAuth `?client=native` + single-use ticket redemption.
- `POST /push/native/register` / `DELETE /push/native/register/{device_id}` (APNs/FCM dispatch in `backend/app/notifications/apns_client.py`, `fcm_client.py`).
- Analytics `POST /admin/track` accepts routeless `page_view` events for `platform ∈ {ios, android}` with a fixed `SCREEN_NAMES` set (`backend/app/analytics/taxonomy.py`).
- `frontend/public/.well-known/apple-app-site-association` and `assetlinks.json` exist (Universal/App Links).

**Recommendation for Base44:** use **Bearer-token auth only** (store the token in secure storage / app storage), and treat the Discord button as a link to `{API}/auth/discord/login?client=native` + a `/auth/native-complete` route that redeems the ticket — this avoids the cookie/fragment machinery entirely. Verify `NATIVE_APP_UNIVERSAL_LINK_BASE` points to the Base44 app origin before relying on it.

---

## 7. Route Map

53 page routes. "Group" = Next.js route group (determines chrome).

```
/                                   (home)  dashboard | signed-out → OpeningExperience
├── welcome                         (marketing) public
├── commissioners                   (marketing) public
├── weekend                         public neon landing (no chrome)
├── lounge/[slug]                   public password video room join (no chrome)
├── auth/complete                   OAuth web landing (plumbing)
├── auth/native-complete            OAuth native landing (plumbing)
├── login                           (app) public
├── forgot-password                 (app) public
├── reset-password?token=           (app) public
├── join-co-owner?code=             (app) Session
├── leagues                         (app) Session  — league hub: create/join/switch/claim/rename/roles
├── league?season=                  (app) LeagueRead — League "Overview"
├── standings?season=               (app) LeagueRead — tabs: Standings | Scoreboard | Playoffs
├── power-rankings?view=&season=&week=  (app) LeagueRead — tabs: This Week | Season Trend | All-Time
├── rivalries                       (app) LeagueRead
├── rules                           (app) Public (static rulebook)
├── history                         (app) LeagueRead — hub tiles
│   ├── (→ /seasons/[season]/awards)
│   ├── (→ /players)                owner "Player Cards"
│   └── (→ /chug)
├── activity                        (app) LeagueRead — league transaction feed
├── seasons/[season]/awards         (app) LeagueRead
├── seasons/[season]/awards/all-time (app) LeagueRead — record book + award leaderboards
├── seasons/[season]/draft          (app) LeagueRead — draft recap + grades
├── players                         (app) LeagueRead — OWNER trading cards (not NFL players)
├── owners/[ownerId]?season=        (app) LeagueRead — owner profile
├── teams/[teamId]?week=            (app) Session (+LeagueRead on API) — team roster by week
├── matchups/[matchupId]            (app) LeagueRead — swipeable week matchup carousel
├── team                            (app) HasTeam — My Team roster/lineup   [My Team sub-nav]
├── draft                           (app) ActiveLeague — live draft room     [My Team sub-nav]
├── keepers                         (app) ActiveLeague                       [My Team sub-nav]
├── free-agents?position=&search=   (app) HasTeam                            [My Team sub-nav]
├── trades                          (app) HasTeam                            [My Team sub-nav]
├── chug?season=                    (app) LeagueRead — leaderboard/feed/upload
├── gamecast                        (app) Public — NFL games hub
├── gamecast/[gameId]               (app) Public (personalized if signed in)
├── lounge                          (app) Session — host lounges
├── more                            (app) ActiveLeague — beta nav "More" hub
├── settings?section=               (app) Session — profile|notifications|chat|appearance|navigation|labs|account|feedback
├── commissioner                    (app) ActiveCommish — tools hub
│   ├── league                      rename, invite code, playoff settings
│   ├── scoring                     scoring rules
│   ├── members                     roles / remove
│   ├── teams                       reassign / create team for member
│   ├── roster                      keeper rules, roster slots + position max, force-edit roster
│   ├── trades                      trade deadline/review + pending review queue
│   ├── polls                       create/close polls
│   └── espn                        ESPN connection
├── admin                           (app) SiteAdmin — overview
│   ├── navigation                  nav heatmap + feature usage
│   ├── users, users/[userId]
│   └── leagues, leagues/[leagueId]
└── chat?conversation=              (chat) ActiveLeague
```

Special files: `not-found.tsx` (404 page with "Back to Weekend League"), `error.tsx` (route error boundary: "Something went wrong" + Try again / Go home), `global-error.tsx` (root fallback).

Removed/legacy routes referenced in comments but **not present**: `/seasons/[season]/weeks/[week]` (replaced by Standings › Scoreboard tab).

---

## 8. Navigation Architecture

### 8.1 Global chrome by route group

| Group | Header (`NavBar`) | Ticker bar (`AppTickerBar`) | Bottom nav | PullToRefresh | Boot animation |
|---|---|---|---|---|---|
| `(home)` `/` | yes | no (page renders its own tickers) | yes | yes | `HomeWelcomeBackEntry` / `OpeningExperience` |
| `(app)` | yes | yes | yes | yes | `AppEntry` |
| `(chat)` | yes | no | yes | yes | `AppEntry` |
| `(marketing)`, `/weekend`, `/lounge/[slug]` | no | no | no | no | no |

`PageShell` (main container): `max-w-5xl` centered, `py-6 pb-24 sm:pb-6` (bottom padding clears the mobile tab bar); `/draft` widens to `max-w-[100rem]`; `/chat` uses a fixed-height shell.

### 8.2 Primary destinations (`frontend/src/lib/navDestinations.ts`)

Default order (both desktop top nav and mobile bottom bar): **My Team · League · Home · Matchup · Gamecast**.

| Key | Label | Href | Color (Cosmic theme) | Shown when |
|---|---|---|---|---|
| team | My Team | `/team` | `#a855f7` | signed in |
| league | League | `/league` | `#6366f1` | always |
| home | Home | `/` | `#f5f4ec` | always |
| matchups | Matchup | `/matchups/{myWeek.matchup.matchup_id}` if the user has a matchup this week, else `/standings` | `#ec4899` | always |
| gamecast | Gamecast | `/gamecast` | `#ef4444` | always |

- Desktop (`sm:` ≥640 px): `PrimaryNav` pills in the sticky header, plus a chat icon with unread badge (`ChatNavLink variant="header"`), plus `AuthStatus` (Sign in link or `AccountMenu`).
- Mobile (<640 px): `BottomNav` fixed bar, icon + 11 px label per tab, `pb-[env(safe-area-inset-bottom)]`.
- "LIVE" marks: My Team / Matchup show LIVE when the user's matchup has started **and** an NFL game is live; Gamecast shows LIVE when any NFL game is live (`state === "in"` on `/nfl/scoreboard`).
- Active state: `aria-current="page"` via `isSectionActive(section, pathname)` (`components/nav/NavLink.tsx`).
- Order is user-customizable (Settings › Navigation, stored in `owner_preferences.bottom_nav_order`) — **currently broken, see §27 C1**.

### 8.3 Account menu (`AccountMenu.tsx`)

Trigger = display name (+ green dot if commissioner). Opens a bottom sheet on mobile / dropdown on desktop with: Profile (`/settings?section=profile`), Leagues, Lounge, Commissioner Tools (commissioner only), Settings, Feedback, Notifications, Admin (site owner only), Log Out (red). Keyboard: arrow keys, Escape; click-outside closes.

### 8.4 League sub-nav (`LeagueSubNav.tsx`)

Shown at the top of League-family pages. Row 1 (3-col grid): **Overview** (`/league`), **Standings**, **Power Rankings**. Row 2 (4-col grid): **Rivalries**, **Rules**, **History**, **Activity**. Mobile-only "‹ League" back link. Right side: `LeagueSwitcher` chip (active league name ▾ → sheet listing `GET /leagues/mine`, tap → `POST /leagues/{id}/select` → `router.refresh()`; "Manage leagues" → `/leagues`).

### 8.5 My Team sub-nav (`MyTeamSubNav.tsx`)

Horizontally scrollable pills: **Roster** (`/team`) · **Draft** · **Keepers** · **Free Agents** · **Trades**.

### 8.6 Season tabs (`SeasonTabs.tsx`)

Text links for every season from `GET /seasons` (newest first), optional extra tab (e.g., "All-Time Records", "All-Time" on Chug). Active = bold underline.

### 8.7 "Try the new look" (Labs) navigation — opt-in variant

When `owner_preferences.beta_layout === true`:
- Desktop header uses `PrimaryNavBeta`: **Home · League · Matchup · Chat · More**.
- Mobile: the header and bottom bar are replaced by `MobileNavDrawer` — a floating hamburger (top-left, 44 px circle) opening a left slide-in drawer (82vw, max 320 px, swipe-left or Escape or scrim-tap to close) with: brand, display name, active league + "Switch ›", primary items (Home, My Team, League, Matchup, Gamecast [LIVE], Chat [unread badge, "In Room" when the open Watch Party room is live], Lounge), secondary items (Settings, Notifications, Feedback, Commissioner Tools, Admin), Log Out.
- `/more` page exists for this variant (tiles for My Team, Draft, Keepers, Free Agents, Trades, Gamecast, Settings, League Management).
- `BottomNavBeta.tsx` exists but is **not rendered anywhere** (dead code).

Also: `design_direction === "stadium"` adds `StadiumDock`, a floating pill dock (Home, Matchup, Gamecast icons) above the bottom edge on mobile.

**Base44 recommendation:** implement the default (non-beta) navigation first. Treat Labs variants as optional.

### 8.8 Tickers

- `AppTickerBar` (all `(app)` pages): strip 1 = NFL scores from `/nfl/scoreboard` (games link to `/gamecast/{id}` when `/nfl/live-games` has a matching game); strip 2 = league ticker from `/seasons/{s}/weeks/{w}/ticker` (`"Team 88.4 (⭐ Player 23.1) vs Team …"`), falling back to "Week N kicks off in …" before any matchup starts.
- Home renders its own tickers plus rivalry alerts, Game of the Week, overachiever, bench crime, boom, and "👑 {team} leads the league" items (`buildTickerItems` in `(home)/page.tsx`).
- `LiveTicker.tsx`: CSS marquee, content duplicated for seamless loop, faster on game day, pauses on touch/drag/hover and resumes.

---

## 9. Screen-by-Screen Specification

Format per screen: **Route · Access · Purpose · Entry points · Layout · Data (GET) · Mutations · States · Responsive**. Every page below except marketing/auth also carries the global chrome from §8. Every authenticated page renders `SignInCard` when signed out and `NeedsLeagueCard` ("signed in, but nothing to show here yet" → link to `/leagues`) when `active_league_id` is null, unless noted.

### 9.1 Home — `/`

- **Access:** Public (signed-out variant) / Session.
- **Signed-out:** renders `OpeningExperience` (full-screen overlay; animated "WELCOME / TO / THE / WEEKEND League" wordmark → tagline → "Enter Here" → `EntryChoiceStage` with **Sign In / Join a League / Create a League** → `AuthScreen`/`SignInCard` preset to that intent). NFL ticker (`/nfl/scoreboard` + `/nfl/live-games` for Gamecast links) runs behind it. Intro is skipped for `prefers-reduced-motion` or when `localStorage.wl_intro_seen` is set. Audio cues exist (`public/audio/*.m4a`, `useIntroSound.ts`, `AudioWarmup.tsx`).
- **Signed-in boot:** `HomeWelcomeBackEntry` plays a "Welcome Back, {display_name}" beat once per real page load; if `active_league_id === null` it holds on that beat with Join/Create buttons (`WelcomeBackStage`).
- **Data (server, parallel):** `GET /auth/me`, `GET /seasons`; then `GET /me/week`, `GET /nfl/scoreboard`, `GET /nfl/live-games`, `GET /leagues/mine`, `GET /settings/preferences`, `GET /seasons/{s}/current-week`; then (only if season and active league exist): `GET /seasons/{s}/standings`, `GET /seasons/{s}/weeks/{w}/awards` and `…/{w-1}/awards`, `GET /seasons/{s}/weeks/{w}/matchup-context`, `GET /rivalries`, `GET /seasons/{s}/weeks/{w}/ticker`, `GET /seasons/{s}/power-rankings/latest-week` → `GET /seasons/{s}/weeks/{lw}/power-rankings`, `GET /chug/deadline` (only if draft status `complete`), `GET /seasons/{s}/weeks/{w}/recap` and `…/{w-1}/recap`, `GET /chug/feed?season=`, `GET /seasons/{s}/activity?limit=5`.
- **Layout (top→bottom):** ambient glow background · "● THE WEEKEND LIVE" label (+ red "GAME DAY" pill when live) · NFL `LiveTicker` · league-name label + league `LiveTicker` · pinned time-sensitive card: `DraftCountdownCard` (draft scheduled & not started) **or** `ChugCountdownCard` (deadline set) · "Live Now" card (live NFL games → Gamecast) · **reorderable card deck** (`HomeCardDeck`, default order yourWeek, standings, powerRankings, matchups, rivalries, awards, chugFeed, activity, discover; "Edit Home" mode shows drag handles; saves `home_card_order`).
  - **Your Week** (`YourWeekCard`): league header + week pill; both team logos (`logo_url` or initials), big scores, live projection under each, split win-probability bar (`win_probability`), team names, "owner • record (streak)", "N yet to play / N in play". Viewer always left. Glowing red border when started && game day. Empty variants: "No matchup yet — the season hasn't started." / "No matchup this week (bye week or the schedule isn't set yet)." / "You're signed in, but not on a team yet." + "Join or create a league →".
  - **League Standings**: top 5 rows (rank, team, W-L[-T]) → `/standings`.
  - **Power Rankings**: top 5 (rank, team, `MovementBadge`) → `/power-rankings`; placeholder text before any week is played.
  - **Other Matchups**: every matchup except mine; live dot, ⭐ GOTW, rivalry emoji, power-rank badges, both scores → `/matchups/{id}`.
  - **Rivalries**: this week's rivalry games (name, H2H) or top-3 rivalries by tier (Legendary > Historic > Developing).
  - **This Week's Awards / Week N Awards**: tile grid (Game of the Week, Boom, Bust, Biggest Bench Crime, Overachiever, Meltdown, Clutch, Choke) + `WeeklyRecapTeaser` (AI recap text; commissioner can regenerate) or, for commissioners with no recap yet, `WeekRecapSection` with a Generate button (`POST /seasons/{s}/weeks/{w}/recap/generate`).
  - **Chug feed** (`ChugFeed`), **League Activity** (`LeagueActivityFeed`, 5 items → `/activity`), **Discover** grid (Gamecast, Standings, Power Rankings, Rivalries, Rules, History, Activity tiles).
- **Mutations:** reorder cards (`PUT /settings/preferences {home_card_order}`), generate recap (commissioner).
- **Live:** `GameDayRefresher` refreshes all server data every 45 s during live NFL games while visible.
- **Labs variant:** `HomePageBeta` receives the same data with a different layout.
- **Responsive:** single column all widths; award tiles 2 cols mobile / 3 cols `sm+`.

### 9.2 Auth screens

| Route | Access | UI | API |
|---|---|---|---|
| `/login?error=` | Public | `SignInCard`: "Continue with Discord" (new tab) · "or" · "Continue with email" → form with Sign in / Create account toggle; fields Display name (signup), Email, Password, Confirm password (signup). Banner for `error=not_a_league_member`. Link to forgot password. | `POST /auth/login`, `POST /auth/signup` |
| `/forgot-password` | Public | `ForgotPasswordForm`: email → shows server `message` | `POST /auth/forgot-password` |
| `/reset-password?token=` | Public | `ResetPasswordForm`: new password (+confirm) | `POST /auth/reset-password` |
| `/join-co-owner?code=` | Session | `JoinCoOwnerForm` | `POST /leagues/co-owner-invites/redeem` then store returned token |
| `/auth/complete` | Public | "Signing you in…" / error text; reads `#token=` | Next route only |
| `/auth/native-complete?ticket=\|error=` | Public | "Signing you in…" / "This sign-in link has expired or already been used…" / "That Discord account isn't linked to a league member yet." | `POST /auth/native/redeem` |

### 9.3 Leagues hub — `/leagues`

- **Access:** Session (client component; on load error shows message and empty list).
- **Purpose:** manage league membership and the active league.
- **Data:** `GET /leagues/mine` → for each league in parallel: `GET /leagues/{id}/teams`, `GET /leagues/{id}/unclaimed-owners`, `GET /leagues/{id}/members`; plus `GET /auth/me` (to hide role controls on own row).
- **Layout:** intro text · error line · **Your leagues** cards: name + role pill (+ Rename for commissioners → inline input max 40 chars, Save/Cancel), "Active" pill or "Switch to this league" button, "Invite code: `xxxx`" + Copy, team list "Team — Owner", "Your team name" input + "Create my team", Members list with Make/Remove commissioner (commissioner only, not self), "Already played in this league before? … This is me: {name}" claim buttons · **Create a league** form (`#create-league`) · **Join a league** form (`#join-league`, invite code). Deep links with those hashes auto-scroll after load.
- **Mutations:** `POST /leagues {name}`; `POST /leagues/join {invite_code}`; `POST /leagues/{id}/teams {team_name}`; `POST /leagues/{id}/select`; `POST /leagues/{id}/claim-owner {owner_id}` (**replace session token**); `PATCH /leagues/{id} {name}`; `PATCH /leagues/{id}/members/{user_id} {role}`. After each: full `refresh()`.
- **States:** "Loading…"; empty "You're not in any leagues yet — create one or join with an invite code below."; per-action busy labels ("Switching…", "Claiming…", "Saving…"); errors shown from `detail`.

### 9.4 League Overview — `/league?season=`

- **Access:** LeagueRead. **Entry:** nav "League".
- **Data:** `GET /seasons`, `GET /seasons/{s}/teams`, `GET /leagues/mine`, `GET /seasons/{s}/power-rankings/latest-week` → `GET /seasons/{s}/weeks/{w}/power-rankings`; client `ActivePollCard`: `GET /leagues/{active}/polls`.
- **Layout:** `LeagueSubNav(active=league)` · "League" + `SeasonTabs` · **League Poll** card (open polls only; option buttons; results after vote) · team list (team name → `/teams/{id}`, `TeamRankBadge`, owner name).
- **Mutations:** `POST /leagues/{id}/polls/{poll_id}/vote {option_index}`.

### 9.5 Standings — `/standings?season=`

- **Access:** LeagueRead.
- **Data:** `GET /seasons`, `GET /seasons/{s}/standings`, `GET /settings/preferences`, `GET /leagues/mine`, power rankings (latest week), `GET /seasons/{s}/playoffs/bracket`, `GET /seasons/{s}/playoffs/projected` (only if bracket empty), `GET /seasons/{s}/current-week`, `GET /seasons/{s}/weeks/{cw}/matchup-context`.
- **Layout:** sub-nav · "Standings" + season tabs · `StandingsViewTabs` (client tabs, no URL change): **Standings** | **Scoreboard** | **Playoffs** (Playoffs tab omitted when no content).
  - Standings: caption ("Final standings (ESPN)." vs "Regular season record — season in progress." + playoff-line and toilet-bowl explanations); header row (sm+ only): Team, [Trend in Labs], W-L-T, PF, PA; rows: rank, team link, power-rank badge, 🏆 Champion (`final_rank===1`, amber bg), 💩 League Loser (last `final_rank`), owner name, record, PF, PA (1 decimal). Inserted divider rows: "Playoff line — top N" (in-progress season, `playoff_team_count`), "🚽 Toilet bowl — bottom 4".
  - Scoreboard: `WeekScoreboardBrowser` — ‹ Week N › (1–17) paging with client `GET /seasons/{s}/weeks/{w}/matchup-context`; list of matchups → `/matchups/{id}`; "No schedule yet."
  - Playoffs: `PlayoffBracket` (rounds, seeds, aggregate scores, winners) + `ProjectedPlayoffPicture` ("if the season ended today").
- **Responsive:** rows stack vertically on mobile (`flex-col`), become a row at `sm`.

### 9.6 Power Rankings — `/power-rankings?view=week|trend|all-time&season=&week=`

- **Data:** week: `GET /seasons/{s}/power-rankings/latest-week` → `GET /seasons/{s}/weeks/{w}/power-rankings`; trend: `GET /seasons/{s}/power-rankings/trend`; all-time: `GET /power-rankings/all-time`.
- **Layout:** sub-nav · title + description · view tabs (links) · season tabs (not for all-time) · Week view: rows rank, team/owner, Luck (1 decimal), SOS (2 decimals), Trend (`MovementBadge`) — horizontal scroll wrapper · Trend view: table Team × Wk columns (Labs: per-team SVG sparkline) · All-time: `PowerRankingsAllTime` categories.
- **Empty:** "No power rankings computed for {season} yet — this fills in once a sync has run for at least one completed week." / "No data for week N." / "No seasons found yet."

### 9.7 Rivalries — `/rivalries`

- **Data:** `GET /rivalries`. **Layout:** cards: emoji + name (or "A vs B"), tier pill, tagline, description, owner A link · `wins_a-wins_b` · owner B link. **Empty:** "No rivalries recorded."

### 9.8 Rules — `/rules`

- **Access:** Public (no auth check; only `GET /seasons` for sub-nav link). **Content is hard-coded** League #1 rulebook ("2026 Official Rulebook", TOC of 14 sections: League Structure & Payouts, Engagement, Keeper/Franchise Tag, Draft Order, Jeffrey's Rule, Sweaty Parlay, Weekly Trash Talk, King's Cup, 2026 Scoring Adoptions, Playoff Tiebreakers, Week 18 Bowl Games, League Kitty, Future Considerations, Commissioner Clause). Not data-driven; not per-league. See §27.

### 9.9 History hub — `/history`

Tiles: **Awards** (`/seasons/{latest}/awards`), **Player Cards** (`/players`), **Chug** (`/chug`). Data: `GET /seasons`, `GET /leagues/mine`.

### 9.10 Season Awards — `/seasons/[season]/awards`

- **Data:** `GET /seasons`, `GET /seasons/{s}/awards`. **Layout:** back ("History"), sub-nav, "Awards" + season tabs + "All-Time Records" extra tab · champion card (🏆 team, owner link) · award list (award_type, detail, owner link). **Empty:** "No awards recorded for {season} yet."

### 9.11 All-Time Records — `/seasons/[season]/awards/all-time`

- **Data:** `GET /records`, `GET /awards/all-time`. **Layout:** `RecordBook` (categories with emoji/label/unit, ranked entries: owner, team, season/week, value, opponent) + `AwardLeaderboards` (category → winners with win counts).

### 9.12 Season Draft Recap — `/seasons/[season]/draft`

- **Data:** `GET /seasons/{s}/draft-grades` (404 → Next `notFound()`). **Layout:** `DraftGradesView` (board of picks, letter grades per owner, AI narratives). **Empty:** "Draft grades haven't been computed for {season} yet — they appear automatically shortly after the real draft finishes."

### 9.13 Player Cards (owners) — `/players`

- **Important naming:** this route shows **owner trading cards**, not NFL players.
- **Data:** `GET /owners`, `GET /seasons`, then per owner in parallel `GET /owners/{id}/career` and `GET /owners/{id}/badges`; card back loads `GET /owners/{id}/profile?season=` on demand (`TeamProfileCard`).
- **Layout:** `CardDeck` — infinite horizontal Cover-Flow deck (3D rotate/scale by distance from center, scroll-driven), tap to flip (`TeamProfileCard` front: owner photo from `public/images/owners/*.jpg`, team/owner name, champion ribbon; back: season/career selector + stat boxes).

### 9.14 Owner Profile — `/owners/[ownerId]?season=`

- **Data:** `GET /owners/{id}/profile?season=` (404→null), `GET /owners/{id}/career`, `GET /owners/{id}/badges`, `GET /seasons/{s}/owners/{id}/draft-grade`.
- **Layout:** back ("Standings") · team name · badges (🏆 N× Champion (years), award chips) · **Season** section with tabs: Regular season / Playoffs period cards (Record, PF, PA), Best week, Worst week, Avg luck, Power rank, Draft grade, draft narrative · **Career (first–last)**: period cards, Best/Worst season, Best/Worst week ever. **Empty:** "No data for this owner." / "No data for {season}."

### 9.15 Team Detail — `/teams/[teamId]?week=`

- **Access:** Session at page level (no NeedsLeague check), API is LeagueRead (404 if team not in active league → `notFound()`).
- **Data:** `GET /teams/{id}`, `GET /seasons/{team.season}/current-week`, `GET /teams/{id}/roster?week=`.
- **Layout:** back ("Standings") · team name · owner link — season · week pills Wk 1…Wk 17 (links) · `RosterList` "Starters" and "Bench / IR" (points, projection, injury, opponent, boom/bust). **Empty:** "No roster data for week N."

### 9.16 Matchup — `/matchups/[matchupId]`

- **Access:** LeagueRead. **Entry:** nav Matchup, Home cards, Scoreboard.
- **Data:** `GET /matchups/{id}` (404 → notFound), then `GET /seasons/{s}/weeks/{w}/matchup-context` (whole week, full rosters). Each matchup is re-oriented so the viewer's team is on the left (`orientMatchupForViewer`).
- **Layout:** back ("Home") · "{season} — Week {week}" · `MatchupCarousel`: top `MatchupSwitcher` strip of every matchup (tap to jump) + horizontal scroll-snap track, one `MatchupDetailPanel` per matchup (swipe = switch, **no refetch**):
  - badges: ⭐ Game of the Week, rivalry badge, playoff badge;
  - `MatchupScoreHeader` (logos, scores, projections, record/streak, power rank) + `WinProbabilityBar`;
  - "Starting Lineups" `StarterComparisonTable` (slot-aligned home vs away starters then Bench; each player: headshot, name, injury tag, game status grey/white treatment, live projection, points; tap a player → stat-breakdown sheet built from `raw_stats` with `humanizeStatCategory` labels);
  - AI narrative paragraph (only if non-null; currently always null per types comment);
  - "Touchdowns" lists; clutch/choke & bench-crime summaries; `HeadToHeadSection` (all-time W-L-T, last 5 meetings).
- **Live:** no polling on this page itself beyond the ticker bar's `GameDayRefresher` (which calls `router.refresh()` and therefore re-runs this page's server fetches).

### 9.17 My Team — `/team`

- **Access:** HasTeam (backend 404 when no team; page shows server null → client fallback fetch → error text).
- **Data:** `GET /me/team`, `GET /me/team/ownership`, `GET /nfl/scoreboard`, `GET /settings/preferences`.
- **Layout:** My Team sub-nav · team name + "Invite Co-Owner" button (→ `POST /leagues/co-owner-invite` → shows `{origin}/join-co-owner?code=…` + Copy) · ‹ Week N › (1–17; `GET /me/team?week=`) · read-only notice when `!is_editable` ("Past week — read only." / "Not the current week yet — read only.") · status line ("Saving…", "Moved X to FLEX.", "Swapped A and B.") · **Starters** (sorted QB, RB, WR, TE, FLEX(RB/WR/TE), D/ST, K) · **Bench** · **Injured Reserve** (only if any).
  - `RosterRow`: slot pill (tappable when editable) · headshot · red dot (red zone) / amber dot (on offense) · player name (tap → Player Card modal) + injury short code (Q/D/O/IR/PUP/S) + in-game injury tag · "POS · NFL team" · "OPP · game time · position rank vs" · "Bye: Week N" · "N% owned" · "Locked" pill (`is_locked`) · points · "Proj x.x" (live projection vs pregame).
  - **Edit Lineup sheet** (bottom sheet/modal): "Moving **X** — tap where they should go." Sections Starters / Bench / Injured Reserve listing destination slots with current occupant or "Empty"; tapping an occupied slot = swap, empty slot = move. If player is locked: "…game has already started this week — their lineup slot is locked until next week."
- **Mutations:** `POST /me/team/lineup/move {sleeper_player_id,to_slot}`, `POST /me/team/lineup/swap {sleeper_player_id_a,_b}` → response `{roster}` merged into local state (only `lineup_slot` updated). Drop happens from the Player Card modal (`POST /me/team/lineup/drop`, then full page reload).
- **Live:** polls `GET /me/team` every 15 s during live NFL games while visible and on the editable week.
- **Empty:** "Your roster is empty — the draft hasn't happened yet." + "Go to Draft".

### 9.18 Free Agents — `/free-agents?position=&search=`

- **Access:** HasTeam-ish (ActiveLeague for list; add/claim need a team).
- **Data:** `GET /seasons`, `GET /seasons/{s}/current-week`, `GET /me/team/free-agents?position=&search=`, `GET /free-agents/waiver-settings`, `GET /seasons/{s}/waivers/priority?week=`; client `MyWaiverClaims`: `GET /me/team/waivers`.
- **Layout:** My Team sub-nav · intro ("…This league uses FAAB bidding ($N budget)" or "standard waiver priority") · `PlayerSearchInput` (debounced URL `search` param) · position filter links All/QB/RB/WR/TE/D/ST/K (D/ST → `position=DEF`) · **My waiver claims** list (status, Cancel for pending) · collapsible "Waiver order — Week N" (priority list + explanation) · `FreeAgentsList` rows (Players | Proj | Score columns; waiver/game-locked indicators with tooltips).
- **Interaction state machine (`FreeAgentsList`)**: Add → confirm → submitting → success | error | `roster_full` → needs-drop (lists my roster via `GET /me/team`) → confirm-drop → submit with drop · On `on_waivers` (or `waiver_clears_at`/`game_locked`) → claim-menu → optional pick-drop → claim-confirm-drop → claim-submitting → claim success/error.
- **Mutations:** `POST /me/team/free-agents/add {sleeper_player_id, drop_sleeper_player_id|null}`; `POST /me/team/waivers/claim {add_sleeper_player_id, drop_sleeper_player_id|null}`; `POST /me/team/waivers/claim/{id}/cancel`.
- **Empty:** "No free agents found."

### 9.19 Trades — `/trades`

- **Data:** `GET /trades/teams`, `GET /trades/mine`, `GET /trades/teams/{team_id}/roster` (my team + chosen partner), `GET /auth/me`.
- **Layout:** "Propose a trade": partner team select → two `PlayerPicker` columns "You give" / "You receive" (checkbox multi-select) → "Propose trade" (disabled until both sides non-empty) · "My trades": `TradeRow` with You give / You receive (or They give…), status label (pending, "Awaiting commissioner review", Accepted, Rejected, Cancelled, vetoed); receiver sees Accept / Reject on pending; proposer sees Cancel.
- **Mutations:** `POST /trades {receiving_team_id, give:[sleeper ids], receive:[...]}`, `POST /trades/{id}/accept|reject|cancel` → then refresh.
- **Empty:** "No other teams in this league yet." / "No trades yet." / "No players."

### 9.20 Keepers — `/keepers`

- **Data:** `GET /keepers/me` (rules + roster_pool from **prior season ESPN roster** + selections).
- **Layout:** My Team sub-nav · "Keepers" · rules summary (max keepers, max consecutive years, deadline, auto-lock countdown when within 1 h of `draft_scheduled_start`) · roster pool checkboxes (ineligible players greyed with consecutive-year info) · "Save keepers" · read-only notices ("Keepers are locked in for this season — selections are read-only." / "The keeper deadline has passed…") · commissioner-only inline `CommissionerRules` (edit rules, Lock/Unlock keepers).
- **Mutations:** `PUT /keepers/me {espn_player_ids}`; commissioner `PUT /keepers/rules`, `POST /keepers/rules/lock|unlock {season}`.
- **Signed-out inconsistency:** shows a direct "Sign in with Discord" link to the backend instead of `SignInCard` (§27).

### 9.21 Draft Room — `/draft`

- **Access:** ActiveLeague; setup/controls ActiveCommish.
- **Data (server):** `GET /draft/state` (404 → null), `GET /draft/pool`, `GET /seasons`, `GET /seasons/{latest}/teams`, `GET /settings/preferences`, and `GET /seasons/{s}/draft-grades` when status `complete`. Client: `GET /draft/queue`, WebSocket `/draft/ws` (§13.2), debounced pool re-query on filter/search (300 ms).
- **Layout (wide, up to 100 rem):**
  - No draft yet: commissioner sees `DraftSetupPanel` ("Commissioner: set up the draft" — draft order from teams, roster slots prefilled from `/draft/roster-slots`, pick seconds default 90, "Create draft"); others see "No draft has been set up yet."
  - Header status card: "Draft complete" / "Paused" / "Draft room open" (within 60 min of `scheduled_start`) / "Not started"; on-the-clock team with presence dot ("Signed into the draft"); pick countdown from `current_pick_deadline`; "Draft is starting momentarily…"; non-commissioner pre-schedule text "The draft hasn't been scheduled yet — check back soon."
  - Commissioner `DraftSetupPanel` (when a draft exists): schedule editor (datetime-local, detected timezone label, `PUT /draft/schedule`), edit order ("Click teams below in the new order." → `PUT /draft/order`), Seed keepers (`POST /draft/seed-keepers`, shows unresolved list on 400), Start / Pause / Resume / Undo last pick / Reset (confirm dialog "This wipes every pick and roster this draft has made — for real, not just a mock. Reset anyway?").
  - Player pool: position filter (QB RB WR TE K DEF), search ("Search players…"), rows with `PositionBadge`, name (→ player card), team, ADP (`search_rank`), projection, bye, injury; queue toggle (+/−); Draft button when it's my turn.
  - **My Queue (N)**: ordered list with move up/down and remove.
  - **My team (N)**: my picks. **Recent picks**: pick list with AUTO / KEEPER tags. `DraftBoard` grid (round paging ‹ ›, "On the clock").
  - **Draft room chat**: message list + input ("Message the room…" / "Reconnecting…" when socket closed).
  - Complete: `DraftGradesLeaderboard` with grades and narratives.
- **Mutations:** `POST /draft/pick`, queue `POST /draft/queue`, `DELETE /draft/queue/{id}`, `PUT /draft/queue/reorder`, commissioner routes in §11.7. After a pick: refetch state + pool; all clients refetch on any non-chat/presence WS event.

### 9.22 Chug — `/chug?season=`

- **Data:** `GET /chug/seasons`, `GET /chug/leaderboard?season=`, `GET /chug/feed?season=`, `GET /seasons`.
- **Layout:** sub-nav (History) · `ChugUpload` card ("Submit a Chug", .mp4/.mov/.m4v, commissioner "Credit to" select; result shows time/smoothness/hype/final + roast) · "🍺 Chug Leaderboard" + season tabs + "All-Time" · rule text (Jeffrey's Rule) · `ChugFeed` (entries with score, roast, "watch video" → `GET /chug/{id}/video` presigned URL) · Leaderboard rows: rank, owner link, "completed/owed done", "avg N/10", "N owed right now", "$fine fine (N chugs)" + commissioner `ChugFineButton`, commissioner `ChugCommishActions` (record payment, waive doubling per week), "Lifetime: N".
- **Mutations:** upload (§20.9), `POST /chug/standing/{owner}/clear-fine?amount=`, `/record-payment?amount=`, `/waive-doubling?week=`.
- **Empty:** "No chug data yet."

### 9.23 League Activity — `/activity`

- **Data:** `GET /seasons/{latest}/activity?limit=50`. **Layout:** sub-nav · title + disclaimer ("…starts from whenever this feature shipped…") · `LeagueActivityFeed` items: roster (source free_agent/waiver/commissioner, added/dropped player+position) or trade (teams, assets). **Empty:** "No activity yet."

### 9.24 Gamecast hub — `/gamecast`

- **Access:** Public. **Data:** `GET /nfl/scoreboard`, `GET /nfl/live-games`.
- **Layout:** title + description · groups "Live now" / "Upcoming" / "Final": rows "Away @ Home" (full team names), status detail, score (not for upcoming); rows link to `/gamecast/{gameId}` only when a Gamecast match exists (`TrackedGamecastLink` also fires analytics). **Empty:** "No games scheduled right now — Gamecast lights up once real NFL games are on the slate…"

### 9.25 Gamecast game — `/gamecast/[gameId]`

- **Data:** `GET /nfl/games/{id}` (null → "Game not found" screen), `GET /auth/me`, `GET /settings/preferences`, `GET /nfl/scoreboard`, `GET /nfl/live-games`; client: `/nfl/gamecast/ws` (if live/scheduled and signed in), `GET /nfl/games/{id}/fantasy-impact` (polled while live).
- **Layout:** back ("Gamecast") · "AWY @ HOM" · switcher chips for other live games · `GamecastShell`: `GameHeader` (scores, period/clock, connection state, "updated Ns ago") · `FieldVisualization` (possession, `yards_to_goal`, red zone) + `CurrentDrive` · `ScoringSummary` + `FantasyImpact` (your players / opponent players / game leaders with fantasy points; anonymous users see only game leaders) · `PlayByPlay` (plays with down/distance, scoring/turnover flags, enter animations).

### 9.26 Chat — `/chat?conversation=`

- **Access:** ActiveLeague. **Data:** `GET /chat/conversations` (server), client: `GET /chat/members`, `GET /settings/preferences`, `GET /watch-party/rooms`, `GET /chat/conversations/{id}/messages[?before=]`, WebSocket `/chat/ws`.
- **Layout:** fixed-height panel (fills viewport minus chrome). Mobile: list **or** thread (thread replaces list; back button). Desktop (`sm+`): list sidebar + thread side-by-side.
  - `ConversationList`: order Commish's Corner (📢) → League → DMs; avatar or avatar-cluster, name, last message preview, unread count; "New message" (`NewMessageModal` → choose member → `POST /chat/conversations/direct`); `WatchPartyBar` (open room live state, private rooms, create party).
  - `MessageThread`: header (name, member count, `GroupInfoModal` → `GET /chat/conversations/{id}/members`), "load older" (paging by `before`, page size 50), messages (`MessageBubble`: mine/other styles, chat color, logo, reply preview, @mention highlight, image, reactions 😂 🔥 💀 👍 ❤️ 😭 with counts/names, delete own), typing indicator, read receipt line for DMs ("Seen"), `seen_by` for groups. Commish's Corner renders `AnnouncementFeed`/`AnnouncementCard` (title + long body) and non-commissioners get a locked composer (`can_post=false`); commissioners get `PostAnnouncementForm` (title required).
  - `MessageComposer`: textarea, @mention picker (members), reply-to chip, image attach/paste (Vercel Blob upload), `GifPicker` (`GET /chat/gifs?search=`), send. One-time `AiTrainingNoticeModal` before first send (sets `ai_training_notice_seen`, `ai_training_opt_out`).
  - Watch Party: selecting a room opens `WatchPartyRoom` (LiveKit video conference) with room chat reusing the room's `conversation_id`, `FantasyTicker` from `/watch-party/ws`; `NewPartyModal`, `ManagePartyModal` (host/commissioner remove members).
- **Mutations:** send/typing via WS; `POST /chat/conversations/{id}/read` on open/new message; `POST /chat/messages/{id}/react {emoji}`; `DELETE /chat/messages/{id}`; `POST /watch-party/rooms`, `DELETE /watch-party/rooms/{id}/members/{owner}`, `POST /watch-party/rooms/{id}/token`.

### 9.27 Lounge — `/lounge` and `/lounge/[slug]`

- `/lounge` (Session, client): "Start a password-protected video room…"; form Room name, Your display name (optional, 40), Set a password (min 8) → "Create & enter lounge" (`POST /lounge/rooms` then `POST /lounge/rooms/{slug}/join`) → `LoungeVideoRoom` (big shared screen, NFL sidebar polling `/nfl/scoreboard` every 30 s, chat, custom screen-share with audio). "Your lounges" list: Join (host needs no password), Close (`DELETE /lounge/rooms/{id}`), share link `{origin}/lounge/{slug}` + Copy.
- `/lounge/[slug]` (Public, no chrome): `GET /lounge/rooms/{slug}` → not found / closed messages / `LoungeJoinRoom` (password + display name → `POST /lounge/rooms/{slug}/join`; 401 "Incorrect password", 429 lockout after 8 failures for 15 min).

### 9.28 Settings — `/settings?section=`

- **Data:** `GET /settings/me` (null → SignInCard), `GET /auth/me`; sections fetch `GET /settings/preferences`.
- **Layout:** `SettingsShell` sidebar (desktop) / section list (mobile) with sections:
  - **Profile:** logo upload with canvas cropper (`LogoUploadCropper` → Vercel Blob via `/api/settings/logo-upload`, 2 MB, jpeg/png/webp → `PUT /settings/logo {logo_url}`), display name (`PUT /settings/display-name`, reset `POST /settings/display-name/reset`), team name (`PUT /settings/team-name`, reset), chat color presets (`PUT /settings/chat-color`).
  - **Notifications:** push enable/disable on this device (Web Push; iOS requires installed PWA), "Send test" (`POST /push/test`), category toggles (notify_* fields), Sunday Mode presets full_send/game_day/leave_me_alone (`POST /settings/preferences/sunday-mode`), quiet hours.
  - **Chat:** read receipts, typing indicators, message previews, mention highlighting, AI training opt-out.
  - **Appearance:** Look (Calm/Cosmic `theme`), neon intensity (subtle/standard/high), reduced motion, accent color, Your Week color, border glow color (hex). Mirrors values into `wl_*` cookies.
  - **Navigation:** drag-reorder bottom-nav destinations (`bottom_nav_order`) — **save currently rejected by backend (§27 C1)**.
  - **Labs:** "Try the new look" (`beta_layout`), Design Direction default/broadcast/stadium.
  - **Account & Security:** linked sign-in methods (email/Discord/Google/password flags), Delete account (`DELETE /auth/me`).
  - **Feedback:** message + optional screenshot (Blob via `/api/chat/upload`) → `POST /feedback`; commissioners also see recent feedback (`GET /feedback`).
- `SavedIndicator` shows per-field save confirmation.

### 9.29 Commissioner Tools — `/commissioner/*`

Hub tiles (ActiveCommish): League Settings, Scoring Rules, Members, Teams, Roster & Keepers, Draft (→ `/draft`), Trades, Polls, ESPN Connection. Every sub-page has back → "Commissioner Tools".

| Sub-page | Component | Reads | Writes |
|---|---|---|---|
| `/commissioner/league` | `LeagueSettingsSection` | `/leagues/mine`, `/league/playoff-settings` | `PATCH /leagues/{id}`, `PUT /league/playoff-settings {season, playoff_team_count, weeks_per_matchup, start_week}`; copy invite code |
| `/commissioner/scoring` | `ScoringRulesSection` | `GET /league/scoring-rules[?season=]` | `PUT /league/scoring-rules {season, rules:{stat_category: points}}` (grouped by category, `lib/scoringLabels.ts`) |
| `/commissioner/members` | `MembersSection` | `/leagues/mine`, `/leagues/{id}/members` | `DELETE /leagues/{id}/members/{user_id}` (role change lives on `/leagues`) |
| `/commissioner/teams` | `TeamsSection` | `/leagues/mine`, `/leagues/{id}/teams`, `/leagues/{id}/members` | `POST /leagues/{id}/teams/{team}/reassign {user_id}`, `POST /leagues/{id}/teams/for-member {user_id, team_name}` |
| `/commissioner/roster` | `KeeperRulesSection`, `RosterSlotsSection`, `ForceEditRosterSection` | `/keepers/rules`, `/draft/roster-slots`, `/draft/position-max`, `/leagues/mine`, `/leagues/{id}/teams`, `/leagues/{id}/teams/{team}/roster` | `PUT /keepers/rules`, lock/unlock; `PUT /draft/roster-slots` (409 once a draft exists), `PUT /draft/position-max`; force add/drop/move/swap (§11.9) with waiver override confirm |
| `/commissioner/trades` | `TradeSettingsAndReview` | `/trades/settings`, `/trades/pending`, `/trades/teams` | `PUT /trades/settings {season, trade_deadline, review_required}`, `POST /trades/{id}/review {approve}` |
| `/commissioner/polls` | `PollsManagementSection` | `/leagues/mine`, `/leagues/{id}/polls` | `POST /leagues/{id}/polls {question, options[]}`, `PATCH /leagues/{id}/polls/{poll_id}` (close) |
| `/commissioner/espn` | `EspnConnectionSection` | `/league/espn-connection` | `POST /league/espn-connection {espn_league_id, espn_s2, espn_swid}`, `DELETE`, `POST /league/espn-connection/sync` |

### 9.30 Admin — `/admin/*` (SiteAdmin)

Layout: "Admin — The control room — usage, users, and leagues." + `AdminNav` (Overview, Navigation, Users, Leagues) with its own accent `#38bdf8`.

| Route | Data | UI |
|---|---|---|
| `/admin` | `/admin/overview?days=7`, `/admin/timeseries?days=30`, `/admin/features?days=30`, `/admin/activity?limit=15`, `/admin/alerts`, `/admin/system-health`, `/admin/online`; client polls online + overview on an interval | `KpiCard`s, `LineChart` (custom SVG), `DonutChart`, alerts, activity, health (DB pool, WS counts, uptime, job last-runs), online owners |
| `/admin/navigation` | `/admin/navigation?days=30`, `/admin/features?days=30` | route heatmap + feature usage |
| `/admin/users` | `/admin/users?status=&search=` | filter chips (all/active/inactive/new/commissioner/multiple_leagues/no_league) + search |
| `/admin/users/[userId]` | `/admin/users/{id}` | detail, leagues, recent activity; toggle admin (`PATCH /admin/users/{id}/admin`), delete (`DELETE /admin/users/{id}`, 409 `{detail:{blockers:[…]}}`) |
| `/admin/leagues`, `/admin/leagues/[leagueId]` | `/admin/leagues?days=7`, `/admin/leagues/{id}?days=7` | league list / member activity |

### 9.31 Marketing & special public pages

- `/welcome`: `MarketingHeader`, hero ("Your league deserves better than a spreadsheet with a scoreboard."), description, `CreateLeagueCta`, positioning paragraph, 7 feature cards, footer. Static.
- `/commissioners`: static marketing ("The real questions", "What you actually get", "What we don't do yet").
- `/weekend`: neon "The Weekend" landing (`WeekendLanding`, links to matchups/awards). Uses `GET /seasons` only.

---

## 10. Component Inventory

Grouped by domain. "Reuse" = should become a shared Base44 component. All paths under `frontend/src/components/`.

### 10.1 App shell & navigation

| Component | Role | Notes for rebuild |
|---|---|---|
| `NavBar.tsx` (server) | sticky header + chooses nav variant | fetches `/auth/me`, `/me/week`, `/nfl/scoreboard`, `/settings/preferences`, `/leagues/mine` |
| `nav/PrimaryNav.tsx`, `nav/BottomNav.tsx` | default desktop/mobile nav | reuse; LIVE marks |
| `nav/PrimaryNavBeta.tsx`, `nav/MobileNavDrawer.tsx`, `nav/StadiumDock.tsx` | Labs variants | optional |
| `nav/BottomNavBeta.tsx` | **unused** | skip |
| `nav/NavLink.tsx` | active-state link (`isSectionActive`) | reuse |
| `nav/ChatNavLink.tsx` | chat link with unread badge (`useUnreadChatCount`) | reuse |
| `nav/LeagueSubNav.tsx`, `nav/MyTeamSubNav.tsx`, `nav/SeasonTabs.tsx`, `nav/LeagueSwitcher.tsx` | secondary nav | reuse |
| `nav/icons.tsx` | custom inline SVG icons: Home, Team, League, Matchups, Gamecast, Chat, Lounge, More | recreate as SVG set |
| `AuthStatus.tsx`, `AccountMenu.tsx` | account entry | reuse |
| `PageShell.tsx` | main container widths/padding | reuse |
| `AppTickerBar.tsx`, `LiveTicker.tsx` | tickers | reuse |
| `PullToRefresh.tsx` (+`lib/usePullToRefresh.ts`) | custom PTR gesture (70 px threshold, 110 px max, 0.5 resistance, ignores nested scrollers) | mobile only |
| `GameDayRefresher.tsx` | 45 s refresh during live games | replace with query invalidation |
| `OfflineBanner.tsx` | `navigator.onLine` banner | reuse |
| `AppEntry.tsx`, `HomeWelcomeBackEntry.tsx`, `OpeningExperience.tsx`, `EntryChoiceStage.tsx`, `WelcomeBackStage.tsx`, `AuthScreen.tsx`, `BrandMark.tsx`, `LeagueWordmark.tsx`, `AudioWarmup.tsx` | boot/intro animation + brand | optional polish phase |
| `BackButton.tsx` | history back with fallback href | reuse |
| `SignInCard.tsx`, `NeedsLeagueCard.tsx` | auth / no-league gates | reuse |
| `PageViewTracker.tsx` | analytics page_view per route | reuse |
| `ServiceWorkerRegistration.tsx`, `NativePushRegistration.tsx` | PWA / Capacitor push | platform-specific |
| `PresenceProvider.tsx` | app-wide chat WS for presence | reuse (§13.1) |
| `players/PlayerCardProvider.tsx`, `players/PlayerCardModal.tsx` | global NFL player modal (`openPlayerCard(sleeperId)`) | reuse |

### 10.2 Cards, badges, primitives

`YourWeekCard`, `MatchupCard`, `DraftCountdownCard`, `ChugCountdownCard`, `ChugDueCard` (**unused**), `ActivePollCard`, `WeeklyRecapTeaser`, `WeekRecapSection`, `LeagueActivityFeed`, `ChugFeed`, `RosterList`, `TeamProfileCard`, `CardDeck`, `RecordBook`, `AwardLeaderboards`, `PowerRankingsAllTime`, `RankedCategoryCard`, `PlayoffBracket` (+`ProjectedPlayoffPicture`), `PlayoffBadge`, `TeamRankBadge` (#N power rank chip), `MovementBadge` (▲/▼ movement), `PlayerHeadshot` (ESPN/Sleeper CDN with team-logo fallback), `PlayerSearchInput`, `HomeCardDeck`, `HomePageBeta`, `WeekendLanding`, `marketing/MarketingChrome`.

### 10.3 Feature components

| Domain | Components |
|---|---|
| My Team / transactions | `MyTeamApp` (roster + edit-lineup sheet), `FreeAgentsList`, `MyWaiverClaims`, `TradesApp`, `KeepersPanel`, `JoinCoOwnerForm`, `ForgotPasswordForm`, `ResetPasswordForm` |
| Matchups | `matchups/MatchupCarousel`, `MatchupSwitcher`, `MatchupDetailPanel`, `MatchupScoreHeader`, `WinProbabilityBar`, `StarterComparisonTable`, `HeadToHeadSection`, `MatchupBadges`, `NarrativeSection`, `TeamSummary`, `WeekScoreboardList`, `liveProjection` (`LiveProjectionValue`, `InGameInjuryTag`), `orientMatchup.ts`; `MyTouchdownsSection` (**unused**) |
| Standings | `standings/StandingsViewTabs`, `standings/WeekScoreboardBrowser` |
| Draft | `draft/DraftRoom`, `DraftSetupPanel`, `DraftBoard`, `DraftGradesLeaderboard`, `DraftGradesView`, `PositionBadge` |
| Gamecast | `gamecast/GamecastShell`, `GameHeader`, `FieldVisualization`, `CurrentDrive`, `PlayByPlay`, `ScoringSummary`, `FantasyImpact`, `TrackedGamecastLink` |
| Chat | `chat/ChatApp`, `ConversationList`, `MessageThread`, `MessageBubble`, `MessageComposer`, `GifPicker`, `NewMessageModal`, `GroupInfoModal`, `AnnouncementFeed`, `AnnouncementCard`, `PostAnnouncementForm`, `AiTrainingNoticeModal` |
| Watch Party / Lounge | `watchparty/WatchPartyBar`, `WatchPartyRoom`, `WatchPartyChat`, `FantasyTicker`, `NewPartyModal`, `ManagePartyModal`, `ParticipantVolumePanel`; `lounge/LoungeVideoRoom`, `LoungeJoinRoom`, `LoungeNflSidebar` |
| Chug | `ChugUpload`, `ChugFeed`, `ChugFineButton`, `ChugCommishActions`, `ChugCountdownCard` |
| Settings | `settings/SettingsShell`, `ProfileSection`, `LogoUploadCropper`, `NotificationsSection`, `ChatSection`, `AppearanceSection`, `NavigationSection`, `LabsSection`, `AccountSection`, `FeedbackSection`, `ToggleRow`, `SavedIndicator` |
| Commissioner | `commissioner/LeagueSettingsSection`, `ScoringRulesSection`, `MembersSection`, `TeamsSection`, `RosterSlotsSection`, `KeeperRulesSection`, `ForceEditRosterSection`, `TradeSettingsAndReview`, `PollsManagementSection`, `EspnConnectionSection` |
| Admin | `admin/AdminNav`, `AdminOverview`, `AdminNavigationHeatmap`, `AdminUsers`, `AdminUserDetail`, `AdminLeagues`, `AdminLeagueDetail`, `KpiCard`, `LineChart`, `DonutChart` |

### 10.4 Pure helper modules to port as-is (no DOM)

`lib/rosterSlots.ts` (slot eligibility — display only; backend re-validates), `lib/positionColors.ts`, `lib/positionRank.ts`, `lib/injuryStatus.ts`, `lib/scoringLabels.ts`, `lib/gameTime.ts`, `lib/nfl-teams.ts` (team names/colors/logo+headshot URLs), `lib/navDestinations.ts`, `lib/sectionColors.ts`, `lib/chatFormat.ts`, `lib/awardDescriptions.ts`, `lib/adminFormat.ts`, `lib/analyticsEvents.ts`, `components/matchups/orientMatchup.ts`, and the ticker builders in `lib/api.ts` (`buildNflTickerItems`, `buildLeagueTickerItems`, `buildKickoffCountdownItem`, `formatCountdown`), `lib/gamecastApi.ts` (`findGamecastId`, `withGamecastLinks`).

---

## 11. API Catalog

**Base URL:** the FastAPI origin (production value not in repo; local `http://localhost:8000`; the Base44 compose uses `https://8000-${BASE44_PUBLIC_HOST_SUFFIX}`).
**Auth header:** `Authorization: Bearer <session JWT>` (or `session` cookie).
**Errors:** FastAPI shape `{"detail": "<string>"}` unless noted. 422 = Pydantic validation (`{"detail":[…]}`) on malformed bodies/params. Auth labels per §6.4. "Types" refer to `frontend/src/lib/*.ts`.
**Notation:** `S` = ACTIVE_SEASON implied by server. "RO" = read-only; "MUT" = mutating.

### 11.1 Auth (`backend/app/routers/auth.py`)

| Method & path | Auth | Request | Response | Errors | Used by |
|---|---|---|---|---|---|
| GET `/auth/discord/login?client=web\|native` | Public | — | 302 → Discord; sets `oauth_state` cookie | 400 bad client | SignInCard (link, new tab) |
| GET `/auth/discord/callback?code&state` | Public | — | 302 → `{FRONTEND_URL}/auth/complete#token=…` (web, also sets backend cookie) / `/auth/native-complete?ticket=…` (native) / `…/login?error=not_a_league_member` | 400 invalid state | browser redirect |
| GET `/auth/google/login`, `/auth/google/callback` | Public | same as Discord | same (no membership check) | 400 | **not exposed in UI** |
| POST `/auth/native/redeem` | Public (ticket) | `{ticket}` | `{token}` | 401 invalid/expired/already used | `/auth/native-complete` |
| GET `/auth/me` | Session | — | `Me` (§6.3) | 401 | everywhere |
| POST `/auth/signup` | Public, rate-limited | `{email, password, display_name}` | `{token}` + Set-Cookie | 400 invalid email / password < 8 / empty name; 409 email exists | SignInCard |
| POST `/auth/login` | Public, rate-limited | `{email, password}` | `{token}` + Set-Cookie | 401 `Invalid email or password` | SignInCard |
| POST `/auth/forgot-password` | Public, rate-limited | `{email}` | `{message}` | — | ForgotPasswordForm |
| POST `/auth/reset-password` | Public | `{token, new_password}` | `{message}` | 400 short password / invalid-expired link | ResetPasswordForm |
| POST `/auth/ticket?purpose=ws\|chug_upload\|watch_party_ws` | Session | — | `{ticket}` | 400 bad purpose; 401 | chat, presence, draft, gamecast, watch party, chug upload |
| POST `/auth/logout` | none required | — | 204, bumps token_version, clears cookie | — | `clearSession` |
| DELETE `/auth/me` | Session | — | 204 | 409 created a league / sole commissioner (detail explains) | Settings › Account |

### 11.2 Leagues & membership (`leagues.py`)

| Method & path | Auth | Request | Response | Errors | Used by |
|---|---|---|---|---|---|
| GET `/leagues/mine` | Session | — | `{leagues: League[], active_league_id}`; `League = {id,name,invite_code,created_at,role}` | 401 | NavBar, LeagueSwitcher, /leagues, commissioner sections |
| POST `/leagues/{id}/select` | Session + membership | — | `{active_league_id}` | 403 not a member | LeagueSwitcher, /leagues |
| POST `/leagues` | Session | `{name}` | `League` (role commissioner). Side effects: membership, default scoring rules, owner row, league + commish_corner conversations | 400 empty name | /leagues |
| POST `/leagues/join` | Session | `{invite_code}` | `League` | 404 no league for code | /leagues |
| POST `/leagues/{id}/teams` | MemberOf | `{team_name}` | team `{team_id,team_name,owner_id,owner_name}` | 400 empty; 403; 409 already have a team | /leagues |
| GET `/leagues/{id}/teams` | MemberOf | — | `{teams: Team[]}` (S) | 403 | /leagues, TeamsSection, ForceEditRoster |
| GET `/leagues/{id}/unclaimed-owners` | MemberOf | — | `{owners:[{owner_id,display_name}]}` | 403 | /leagues |
| POST `/leagues/{id}/claim-owner` | MemberOf | `{owner_id}` | `{owner_id, claimed:true, token}` — **store new token** | 403; 409 already claimed | /leagues |
| POST `/leagues/co-owner-invite` | Session with owner | — | `{invite_code}` | 403 no team | MyTeamApp |
| POST `/leagues/co-owner-invites/redeem` | Session | `{invite_code}` | `{owner_id, token}` — **store new token** | 409 used/invalid | /join-co-owner |
| GET `/leagues/{id}/members` | MemberOf | — | `{members:[{user_id,role,joined_at,display_name}]}` | 403 | /leagues, Members, Teams |
| PATCH `/leagues/{id}` | CommishOf | `{name}` (≤40) | `League` (no role) | 400; 403 | /leagues, LeagueSettingsSection |
| PATCH `/leagues/{id}/members/{user_id}` | CommishOf | `{role: "commissioner"\|"member"}` | `{user_id, role}` | 400 own role / bad role; 403; 404 | /leagues |
| DELETE `/leagues/{id}/members/{user_id}` | CommishOf | — | `{user_id, removed:true}` | 400 self; 403; 404 | MembersSection |
| POST `/leagues/{id}/teams/{team_id}/reassign` | CommishOf | `{user_id}` | team | 400 not a member; 404 | TeamsSection |
| POST `/leagues/{id}/teams/for-member` | CommishOf | `{user_id, team_name}` | team | 400; 409 already has team | TeamsSection |

### 11.3 League data (`league.py`, `profile.py`, `awards.py`)

All **LeagueRead** unless marked Public. All RO.

| Method & path | Params | Response (type) | Notes / used by |
|---|---|---|---|
| GET `/seasons` | — | `{seasons:number[]}` | **Public**. Every page (latest = max) |
| GET `/seasons/{s}/current-week` | — | `{season, current_week:number\|null}` | **Public**. `resolveWeek()` → ≥1 |
| GET `/seasons/{s}/teams` | — | `{teams: Team[]}` (`Team` in api.ts) | League, Draft |
| GET `/seasons/{s}/standings` | — | `{standings: StandingsRow[], playoff_team_count}` | `points_for`/`points_against` are **strings** |
| GET `/seasons/{s}/activity?limit=30` | limit | `{items: LeagueActivityItem[]}` | Home (5), Activity (50) |
| GET `/seasons/{s}/playoffs/bracket` | — | `{season, nodes: PlayoffBracketNode[]}` | Standings › Playoffs |
| GET `/seasons/{s}/playoffs/projected` | — | `{season, matchups: ProjectedPlayoffMatchup[]\|null}` | null once a real bracket exists |
| GET `/seasons/{s}/waivers/priority?week=` | week (required) | `{week, priority_order: WaiverPriorityRow[]}` | Free Agents |
| GET `/seasons/{s}/weeks/{w}/matchups` | — | `{matchups: WeekMatchup[]}` | **unused by UI**; client helper calls it without auth (would 401) |
| GET `/seasons/{s}/weeks/{w}/matchup-context` | — | `WeekMatchupContext` | Home, Standings, Matchup, Scoreboard. Heavy (full rosters) |
| GET `/seasons/{s}/weeks/{w}/ticker` | — | `{items: LeagueTickerItem[]}` | tickers |
| GET `/records` | — | `{categories: RecordCategory[]}` | All-Time Records |
| GET `/seasons/{s}/weeks/{w}/power-rankings` | — | `{rankings: WeekPowerRanking[]}` | Home, League, Standings, Power Rankings |
| GET `/seasons/{s}/power-rankings/latest-week` | — | `{week:number\|null}` | ranks only exist for locked weeks |
| GET `/seasons/{s}/power-rankings/trend` | — | `{teams: PowerRankTrendTeam[]}` | Power Rankings › Trend |
| GET `/power-rankings/all-time` | — | `{categories: PowerRankingsAllTimeCategory[]}` | Power Rankings › All-Time |
| GET `/matchups/{id}` | — | `WeekMatchupContextItem` (+`league_id`) | 404 if not in active league |
| GET `/teams/{id}` | — | `TeamDetail` (+`league_id`) | 404 |
| GET `/teams/{id}/roster?week=` | week (required) | `TeamRoster` | Team page |
| GET `/rivalries` | — | `{rivalries: Rivalry[]}` | Home, Rivalries |
| GET `/owners` | — | `{owners: Owner[]}` | Player Cards |
| GET `/owners/{id}/profile?season=` | season (required) | `SeasonProfile` | 404 no profile |
| GET `/owners/{id}/career` | — | `CareerProfile` | 404 |
| GET `/owners/{id}/badges` | — | `OwnerBadges` | |
| GET `/seasons/{s}/awards` | — | `SeasonAwardsResponse` | Awards |
| GET `/seasons/{s}/draft-grades` | — | `SeasonDraftResponse` (`config`, `picks`, `grades`, `narratives` keyed by owner_id) | 404 no draft |
| GET `/seasons/{s}/owners/{id}/draft-grade` | — | `OwnerDraftGradeResponse` | Owner profile |
| GET `/awards/all-time` | — | `{categories: AwardLeaderboardCategory[]}` | All-Time Records |
| GET `/seasons/{s}/weeks/{w}/awards` | — | `WeeklyAwards` (all-null/empty until every NFL game of that week is final) | Home |
| GET `/seasons/{s}/weeks/{w}/recap` | — | `{narrative: WeeklyNarrative\|null}` | Home |
| POST `/seasons/{s}/weeks/{w}/recap/generate?force=` | ActiveCommish, MUT; `force` bool | `GenerateWeeklyRecapResult` (`status`: generated/not_eligible/not_configured/no_matchups) | WeeklyRecapTeaser, WeekRecapSection. Calls Anthropic server-side |

### 11.4 Me / My Team / Free agents / Waivers (`me.py`, `free_agents.py`)

All Session; lineup/waiver routes additionally **HasTeam** (404 `No team found for this owner`).

| Method & path | Request | Response | Errors | Used by |
|---|---|---|---|---|
| GET `/me/week` | — | `YourWeek` | 404 no team; 409 no league | NavBar, Home |
| GET `/me/team?week=` | optional week | `MyTeam` (`roster: RosterEntry[]`, `is_editable`, `roster_slots`) | 404, 409 | My Team (initial + 15 s live poll + week paging), FreeAgentsList (drop picker) |
| GET `/me/team/ownership` | — | `{ownership: Record<sleeper_id, {percent_owned, percent_started}>}` (live ESPN call, partial coverage) | 404 | My Team |
| POST `/me/team/lineup/preview-move` | `{sleeper_player_id, to_slot}` | `LineupMovePreview` | 400/404/409 | **unused by UI** |
| POST `/me/team/lineup/preview-swap` | `{sleeper_player_id_a, sleeper_player_id_b}` | `LineupSwapPreview` | same | **unused by UI** |
| POST `/me/team/lineup/move` | `{sleeper_player_id, to_slot}` | `{roster: RosterEntry[]}` (slim entries, no points) | 404 not on roster; 400 slot ineligible/ambiguous; 409 locked (game started) / no roster config | Edit Lineup sheet |
| POST `/me/team/lineup/swap` | `{sleeper_player_id_a, sleeper_player_id_b}` | `{roster}` | same | Edit Lineup sheet |
| POST `/me/team/lineup/drop` | `{sleeper_player_id}` | `{roster}`; starts the dropped player's waiver clock | 404/409 | PlayerCardModal |
| POST `/me/team/free-agents/add` | `{sleeper_player_id, drop_sleeper_player_id?}` | `{roster, dropped_player}` | **409 `{error:"roster_full", detail}`**; **409 `{error:"on_waivers", detail, clears_at}`**; 400/404 others | FreeAgentsList |
| GET `/me/team/free-agents?position=&search=` | position ∈ QB/RB/WR/TE/K/DEF | `{players: MyFreeAgent[]}` (sorted by projection, then search_rank) | 409 | Free Agents (SSR) |
| GET `/me/team/waivers` | — | `{claims: WaiverClaim[]}` | 404 | MyWaiverClaims |
| POST `/me/team/waivers/claim` | `{add_sleeper_player_id, drop_sleeper_player_id?}` | `WaiverClaim` | 400 not on waivers / duplicate; 404 | FreeAgentsList |
| POST `/me/team/waivers/claim/{id}/cancel` | — | `{status:"cancelled"}` | 400 not cancellable; 404 | MyWaiverClaims |
| GET `/free-agents/waiver-settings` | — (Public) | `{uses_faab, acquisition_budget}` — **live ESPN read** | 500 if ESPN not configured (**UNKNOWN**: no guard seen) | Free Agents |

### 11.5 NFL players (`players.py`)

| Method & path | Auth | Request | Response | Used by |
|---|---|---|---|---|
| GET `/players?position=&search=` | ActiveLeague | query | `{players: PlayerListEntry[]}` (≤300, `is_rostered`) | **unused by UI** (`listPlayers` helper exists) |
| GET `/players/{sleeper_player_id}/card` | ActiveLeague | — | `PlayerCard` (bio, projection, overview/news, weekly_scores, `rostered_team_id/name`, `is_on_my_team`) | PlayerCardModal (global) |

### 11.6 Trades (`trades.py`)

| Method & path | Auth | Request | Response | Errors |
|---|---|---|---|---|
| GET `/trades/teams` | ActiveLeague | — | `{teams: TradeTeam[]}` | |
| GET `/trades/teams/{team_id}/roster` | ActiveLeague | — | `{roster: TradeRosterPlayer[]}` | (no league check on team_id — §27) |
| POST `/trades` | HasTeam | `{receiving_team_id, give: string[], receive: string[]}` | `Trade` | 400 invalid; 403/404/409 |
| GET `/trades/mine` | HasTeam | — | `{trades: Trade[]}` | |
| GET `/trades/pending` | ActiveCommish | — | `{trades: Trade[]}` (awaiting_review) | 403 |
| POST `/trades/{id}/accept`, `/reject` | Session (receiving team's user) | `{}` | `Trade` | 404; 403 not your trade; 409 not pending |
| POST `/trades/{id}/cancel` | Session (proposer) | `{}` | `Trade` | same |
| POST `/trades/{id}/review` | ActiveCommish | `{approve: boolean}` | `Trade` (accepted or vetoed) | 409 not awaiting review |
| GET `/trades/settings` | ActiveLeague | — | `TradeSettings {season, trade_deadline, review_required}` | |
| PUT `/trades/settings` | ActiveCommish | `{season, trade_deadline: ISO\|null, review_required}` | `TradeSettings` | |

`Trade.status ∈ pending | awaiting_review | accepted | rejected | cancelled | vetoed`.

### 11.7 Draft (`draft.py`) — S = ACTIVE_SEASON, league = active league

| Method & path | Auth | Request | Response | Errors |
|---|---|---|---|---|
| GET `/draft/pool?position=&search=` | ActiveLeague | query | `{players: DraftPoolPlayer[]}` | |
| GET `/draft/state` | ActiveLeague | — | `DraftState {config, picks, connected_owner_ids, chat_messages}` | 404 no draft |
| GET `/draft/queue` | ActiveLeague | — | `{queue: string[]}` (sleeper ids in order) | |
| POST `/draft/queue` | ActiveLeague | `{sleeper_player_id}` | `{queue}` | |
| DELETE `/draft/queue/{sleeper_player_id}` | ActiveLeague | — | `{queue}` | |
| PUT `/draft/queue/reorder` | ActiveLeague | `{sleeper_player_ids}` | `{queue}` | |
| POST `/draft/pick` | ActiveLeague | `{sleeper_player_id}` | `{pick, config}`; broadcasts `pick_made` | 409 not your turn / not in progress; 400 drafted/undraftable |
| POST `/draft/setup` | ActiveCommish | `{draft_order:int[] (owner ids), roster_slots:{slot:int}, pick_time_limit_seconds=90, position_max?}` | `DraftState` | 409 exists/started |
| GET `/draft/schedule` | ActiveLeague | — | `{scheduled_start}` | |
| PUT `/draft/schedule` | ActiveCommish | `{scheduled_start: ISO}` | `DraftState` | |
| GET `/draft/roster-slots` | ActiveLeague | — | `{season, roster_slots, editable}` (`editable=false` once a draft exists) | |
| PUT `/draft/roster-slots` | ActiveCommish | `{roster_slots}` | `{season, roster_slots, editable:true}` | 409 draft exists |
| GET `/draft/position-max` | ActiveLeague | — | `{season, position_max, editable:true}` | |
| PUT `/draft/position-max` | ActiveCommish | `{position_max}` | same | |
| PUT `/draft/order` | ActiveCommish | `{draft_order}` | `DraftConfig` | 409 started |
| POST `/draft/reset` | ActiveCommish | — | `{ok:true}`; broadcasts `draft_reset` | |
| POST `/draft/keeper` | ActiveCommish | `{owner_id, round, sleeper_player_id}` | `{ok:true}` | **unused by UI** |
| POST `/draft/seed-keepers` | ActiveCommish | — | `{seeded: SeededKeeper[]}`; broadcasts `keepers_seeded` | **400 `{detail:{message, unresolved:[…]}}`** |
| POST `/draft/start`, `/pause`, `/resume` | ActiveCommish | — | `{type:"draft_status", config}`; broadcast same | 409 |
| POST `/draft/undo-last-pick` | ActiveCommish | — | `{undone_pick, config}`; broadcasts `pick_undone` | 409 nothing to undo |
| WS `/draft/ws?season=&ticket=` | Ticket(ws) | — | §13.2 | close 4401/4404 |

### 11.8 Keepers (`keepers.py`)

| Method & path | Auth | Request | Response | Errors |
|---|---|---|---|---|
| GET `/keepers/me` | ActiveLeague | — | `MyKeepers {rules, roster_pool, selections}` — roster_pool read **live from ESPN** (prior season) | 5xx if ESPN unavailable (**UNKNOWN** handling) |
| PUT `/keepers/me` | ActiveLeague | `{espn_player_ids:int[]}` | `{selections}` | 400 duplicates / over max / not on roster / max years; 409 not open |
| GET `/keepers/rules` | ActiveLeague | — | `KeeperRules` (no `draft_scheduled_start` value here) | |
| PUT `/keepers/rules` | ActiveCommish | `{season, max_keepers, max_consecutive_years?, keeper_deadline?}` | `KeeperRules` | 400 negative; 409 locked |
| POST `/keepers/rules/lock`, `/unlock` | ActiveCommish | `{season}` | `KeeperRules` | unlock 404 no rules |

### 11.9 Commissioner roster tools (`commissioner_lineup.py`) — CommishOf(path), team must be in league for S

| Method & path | Request | Response | Errors |
|---|---|---|---|
| GET `/leagues/{id}/teams/{team_id}/roster` | — | `{roster: RosterEntry-slim[]}` (player_id, player_name, lineup_slot, position, pro_team, injury_status, acquired_via) | 403, 404 |
| POST `/leagues/{id}/teams/{team_id}/roster/drop` | `{sleeper_player_id}` | `{roster}` | |
| POST `/leagues/{id}/teams/{team_id}/roster/add` | `{sleeper_player_id, drop_sleeper_player_id?, override_waivers=false}` | `{roster, dropped_player}` | 409 `{error:"roster_full"}` / `{error:"on_waivers", clears_at}` |
| POST `/leagues/{id}/teams/{team_id}/roster/move` | `{sleeper_player_id, to_slot}` | `{roster}` | (commissioner moves ignore the kickoff lock) |
| POST `/leagues/{id}/teams/{team_id}/roster/swap` | `{sleeper_player_id_a, sleeper_player_id_b}` | `{roster}` | |

### 11.10 League settings (`league_settings.py`)

| Method & path | Auth | Request | Response | Errors |
|---|---|---|---|---|
| GET `/league/scoring-rules?season=` | ActiveLeague | — | `{season, rules: ScoringRule[]}` (`stat_category`, `points_per_unit`) | |
| PUT `/league/scoring-rules` | ActiveCommish | `{season, rules:{category:number}}` | same | |
| GET `/league/playoff-settings` | ActiveLeague | — | `PlayoffSettings` | |
| PUT `/league/playoff-settings` | ActiveCommish | `{season, playoff_team_count>0, weeks_per_matchup=1, start_week?}` | echo | 400 |
| POST `/league/schedule/generate` | ActiveCommish | `{season, weeks}` | `{season, weeks, matchups}` | 409 — **unused by UI** |
| GET `/league/espn-connection` | ActiveLeague | — | `EspnConnectionStatus` | |
| POST `/league/espn-connection` | ActiveCommish | `{espn_league_id, espn_s2, espn_swid}` | `{connected:true, espn_league_id}` (secrets encrypted server-side) | 400 can't connect |
| DELETE `/league/espn-connection` | ActiveCommish | — | 204 | |
| POST `/league/espn-connection/sync` | ActiveCommish | — | `{season, results}` (can take long) | 409 not connected; 502 sync failed |

### 11.11 Polls (`polls.py`)

| Method & path | Auth | Request | Response | Errors |
|---|---|---|---|---|
| POST `/leagues/{id}/polls` | CommishOf | `{question, options:string[] (≥2 non-empty)}` | `Poll` | 400 |
| GET `/leagues/{id}/polls` | MemberOf | — | `{polls: Poll[]}` (`results` = vote counts per option, `my_vote`) | 403 |
| POST `/leagues/{id}/polls/{poll_id}/vote` | MemberOf | `{option_index}` | `Poll` | 404; 409 closed; 400 invalid option |
| PATCH `/leagues/{id}/polls/{poll_id}` | CommishOf | — (closes) | `Poll` | 404 |

### 11.12 Chat (`chat.py`)

| Method & path | Auth | Request | Response | Errors |
|---|---|---|---|---|
| GET `/chat/conversations` | ActiveLeague | — | `{conversations: ChatConversation[]}` | 409 |
| GET `/chat/conversations/{id}/messages?before=&limit=50(≤100)` | participant | — | `{messages: ChatMessage[]}` (oldest→newest) | 403 |
| GET `/chat/conversations/{id}/members` | participant | — | `{members: ChatAvatar[]}` | 403 |
| POST `/chat/conversations/direct` | ActiveLeague | `{owner_id}` | `{conversation_id}` (get-or-create) | 400 self/missing; 404 not a league member |
| GET `/chat/members` | ActiveLeague | — | `{members: ChatMember[]}` (with `online`) | |
| GET `/chat/gifs?search=` (1–100 chars) | Session | — | `{gifs: ChatGif[]}` (GIPHY via server) | 503 not configured; 502 upstream |
| POST `/chat/conversations/{id}/read` | participant | — | `{last_read_message_id}`; broadcasts `read` (if sender has read receipts on) | 403 |
| POST `/chat/messages/{id}/react` | participant | `{emoji}` ∈ 😂 🔥 💀 👍 ❤️ 😭 | `{added}`; broadcasts `reaction` | 400; 403; 404 |
| DELETE `/chat/messages/{id}` | author only | — | `{status:"deleted"}`; broadcasts `deleted` | 403; 404 |
| WS `/chat/ws?ticket=` | Ticket(ws) | — | §13.1 | close 4401 |

Message send is **WebSocket-only** (no REST send endpoint).

### 11.13 Chug (`chug.py`)

| Method & path | Auth | Request | Response | Errors |
|---|---|---|---|---|
| GET `/chug/seasons` | Public | — | `{seasons}` | |
| GET `/chug/leaderboard?season=` | LeagueRead | — | `ChugLeaderboard` | |
| GET `/chug/feed?season=` | LeagueRead | — | `{chugs: ChugFeedEntry[]}` | |
| GET `/chug/{chug_id}/video` | LeagueRead | — | `{url, expires_in}` (presigned S3) | 404 |
| GET `/chug/deadline` | LeagueRead | — | `ChugDeadline {deadline, is_past}` | |
| POST `/chug/upload?ticket=&owner_id=` | Session or Ticket(chug_upload); `owner_id` = commissioner credit-to | multipart `video` (.mp4/.mov/.m4v ≤500 MB) | **streamed text/plain**: whitespace heartbeats every 20 s, then `\n` + JSON result (`can_to_mouth`, scores, `roast`, owed before/after) or `{can_to_mouth:false, error:true, status, message}` | 401; errors mostly inside the stream |
| POST `/chug/standing/{owner_id}/clear-fine?amount=` | ActiveCommish | — | `{owner_id, cleared}` | |
| POST `/chug/standing/{owner_id}/record-payment?amount=1` | ActiveCommish | — | `{owner_id, applied}` | |
| POST `/chug/standing/{owner_id}/waive-doubling?week=` | ActiveCommish | — | `{owner_id, week, waived}` | |
| POST `/chug/standing/undo-week?week=` | ActiveCommish | — | `{season, week, owners_reverted}` | **unused by UI** |

### 11.14 Settings & preferences (`settings.py`)

| Method & path | Auth | Request | Response | Errors |
|---|---|---|---|---|
| GET `/settings/me` | Session (ActiveLeague if owner exists) | — | `MySettings` | 404; 409 |
| PUT `/settings/display-name` | Session | `{display_name}` (1–40, no control chars) | `{display_name}` | 400 |
| POST `/settings/display-name/reset` | Session | — | `{display_name}` | |
| PUT `/settings/chat-color` | Session | `{chat_color: "#rrggbb"\|null}` | echo | 400 |
| PUT `/settings/logo` | Session | `{logo_url: Blob URL\|null}` | echo | 400 not an uploaded image URL |
| PUT `/settings/team-name` | ActiveLeague | `{team_name}` (1–40) | echo | 400; 404 no team |
| POST `/settings/team-name/reset` | ActiveLeague | — | `{team_name}` | |
| GET `/settings/preferences` | Session | — | `OwnerPreferences` | |
| PUT `/settings/preferences` | Session | partial `OwnerPreferences` (only sent keys change) | full `OwnerPreferences` | 400 validation (see §16.3) |
| POST `/settings/preferences/sunday-mode` | Session | `{preset: full_send\|game_day\|leave_me_alone}` | `OwnerPreferences` | 400 |

### 11.15 Push (`push.py`)

| Method & path | Auth | Request | Response | Errors |
|---|---|---|---|---|
| GET `/push/vapid-public-key` | Public | — | `{public_key}` | 503 not configured |
| POST `/push/subscribe` | Session | `{endpoint, keys:{p256dh, auth}, device_label?}` | `{id, device_label, active}`; sets `push_enabled` | 400 |
| POST `/push/unsubscribe` | Session | `{endpoint}` | `{ok:true}` | 404 |
| POST `/push/native/register` | Session | `{device_id, platform: ios\|android, push_token, app_version?, os_version?}` | `{id, device_id, platform, active}` | 422 bad platform; 400; 409 no league yet |
| DELETE `/push/native/register/{device_id}` | Session | — | 204 | 404 — **unused by UI** |
| POST `/push/test` | Session | — | `{delivered, attempted}` | 400 no subscriptions |

### 11.16 Watch Party (`watch_party.py`) & Lounge (`lounge.py`)

| Method & path | Auth | Request | Response | Errors |
|---|---|---|---|---|
| GET `/watch-party/rooms` | ActiveLeague | — | `{open_room: WatchPartyRoom, private_rooms: WatchPartyRoom[]}` (open room auto-created) | |
| POST `/watch-party/rooms` | ActiveLeague | `{name, invited_owner_ids:int[]}` | `{id}` | 400 |
| GET `/watch-party/rooms/{id}/members` | private-room member | — | `{members:[{owner_id,display_name}], created_by_owner_id}` | 404 |
| DELETE `/watch-party/rooms/{id}/members/{owner}` | host or commissioner | — | `{status:"removed"}` | 400 host; 403; 404 |
| POST `/watch-party/rooms/{id}/token` | room access | — | `WatchPartyToken {token, url, room_name}` (LiveKit JWT, 6 h) | 404; 5xx if LiveKit not configured |
| WS `/watch-party/ws?room_id=&ticket=` | Ticket(watch_party_ws) | — | §13.4 | close 4401/4404/4409 |
| POST `/lounge/rooms` | Session | `{name, password (≥8)}` | `{id, slug, name}` | 400 |
| GET `/lounge/rooms` | Session | — | `{rooms: LoungeRoom[]}` (own) | |
| GET `/lounge/rooms/{slug}` | Public | — | `{name, closed}` | 404 |
| POST `/lounge/rooms/{slug}/join` | Public (host skips password) | `{password?, display_name?}` (guests must supply name) | `LoungeJoinResult {token, url, room_name, display_name}` | 400; 401 wrong password; 404; 429 locked |
| DELETE `/lounge/rooms/{room_id}` | creator | — | `{status:"closed"}` | 404 |

### 11.17 NFL / Gamecast (`nfl.py`, `gamecast.py`, `game_day.py`) — all Public

| Method & path | Response | Notes |
|---|---|---|
| GET `/nfl/scoreboard` | `{games: NflGame[]}` | ESPN public scoreboard, proxied. `state: pre\|in\|post` |
| GET `/nfl/live-games` | `{games: GamecastLiveGameSummary[]}` | provider: Sportradar if key, `GAMECAST_PROVIDER=mock`, else ESPN public |
| GET `/nfl/games/{game_id}` | `LiveGame` | 404 unknown id |
| GET `/nfl/games/{game_id}/fantasy-impact` | `GamecastFantasyImpact` | personalized **only via `session` cookie** (not Bearer) — §27 |
| WS `/nfl/gamecast/ws?game_id=&ticket=` | §13.3 | |
| GET `/game-day` | `{is_game_day}` | **unused by UI** |

### 11.18 Feedback (`feedback.py`)

| Method & path | Auth | Request | Response | Errors |
|---|---|---|---|---|
| POST `/feedback` | Session | `{message, page_url?, image_url?}` (message or image required) | `{status:"ok"}` | 400 |
| GET `/feedback` | ActiveCommish (any league) | — | `{items: FeedbackItem[]}` (**all leagues**, 200 max) | 403 |

### 11.19 Admin & analytics (`admin.py`, `admin_lineup.py`)

| Method & path | Auth | Request | Response | Used by |
|---|---|---|---|---|
| POST `/admin/track` | Session (no-op if no owner) | `{session_id, event_name, event_type: page_view\|feature, route?, league_id?, metadata?, device_type?, platform?}` validated against `backend/app/analytics/taxonomy.py` | `{ok:true}` | `PageViewTracker`, `analyticsEvents.ts` (fire-and-forget). 400 unknown event; 429 rate limit |
| GET `/admin/online` | SiteAdmin | — | `{owners: OnlineOwner[]}` | Admin |
| GET `/admin/overview?days=7` | SiteAdmin | — | `AdminOverview` | Admin |
| GET `/admin/navigation?days=30` | SiteAdmin | — | `NavigationHeatmap` | Admin › Navigation |
| GET `/admin/features?days=30` | SiteAdmin | — | `FeatureUsage` | Admin |
| GET `/admin/timeseries?days=30` | SiteAdmin | — | `AdminTimeseries` | Admin |
| GET `/admin/activity?limit=15` | SiteAdmin | — | `AdminActivity` | Admin |
| GET `/admin/alerts` | SiteAdmin | — | `AdminAlerts` | Admin |
| GET `/admin/system-health` | SiteAdmin | — | `AdminSystemHealth` | Admin |
| GET `/admin/users?search=&status=&limit=50&offset=0` | SiteAdmin | — | `AdminUserList` | Admin › Users |
| GET `/admin/users/{id}` | SiteAdmin | — | `AdminUserDetail` | Admin › User |
| PATCH `/admin/users/{id}/admin` | SiteAdmin | `{is_admin}` | `AdminUserDetail` | Admin › User (400 self) |
| DELETE `/admin/users/{id}` | SiteAdmin | — | 2xx | 409 `{detail:{blockers:[…]}}` |
| GET `/admin/leagues?days=7`, `/admin/leagues/{id}?days=7` | SiteAdmin | — | `AdminLeagueList`, `AdminLeagueDetail` | Admin › Leagues |
| POST `/admin/sync`, `/admin/sync/live`, `/admin/weekly-compute?week=`, `/admin/waivers/process?week=&league_id=`, `/admin/playoffs/generate?league_id=`, `/admin/playoffs/resolve?league_id=`, DELETE `/admin/teams/{id}`, POST `/admin/weekly-team-stats?week=`, `/admin/sync/bye-weeks`, `/admin/players/sync`, `/admin/players/sync-projections` | League1Commish (waivers/playoffs: CommishOf the `league_id` query param) | — | ops results | **not used by any UI** (operator tools; e.g. playoff bracket generation has no button) |
| GET `/admin/lineup/teams/{id}/roster`, POST `/admin/lineup/teams/{id}/set`, `/swap` | League1Commish | — | ESPN lineup write tools | **not used by UI** |
| GET `/health` | Public | — | `{status:"ok"}` | infra |

---

## 12. Frontend ↔ Backend Contract

Master table: one row per UI feature. "RT" = real-time mechanism. Auth labels per §6.4.

| UI Feature | Screen | API Endpoint(s) | Method | Auth | Data | Mutation | Real-Time |
|---|---|---|---|---|---|---|---|
| Session check | global | `/auth/me` | GET | Session | `Me` | — | — |
| Email sign in / up | Login, Opening | `/auth/login`, `/auth/signup` | POST | Public | `{token}` | creates session | — |
| Discord sign in | Login | `/auth/discord/login` → callback | GET | Public | redirect | creates session | — |
| Native OAuth completion | `/auth/native-complete` | `/auth/native/redeem` | POST | ticket | `{token}` | — | — |
| Forgot / reset password | auth pages | `/auth/forgot-password`, `/auth/reset-password` | POST | Public | `{message}` | revokes sessions | — |
| Logout | Account menu | `/auth/logout` | POST | — | — | revokes sessions | — |
| Delete account | Settings › Account | `/auth/me` | DELETE | Session | — | deletes login | — |
| League list / switch | LeagueSwitcher, /leagues | `/leagues/mine`, `/leagues/{id}/select` | GET/POST | Session | `League[]` | active league | — |
| Create / join league | /leagues | `/leagues`, `/leagues/join` | POST | Session | `League` | membership | — |
| Create my team | /leagues | `/leagues/{id}/teams` | POST | MemberOf | team | team | — |
| Claim historical owner | /leagues | `/leagues/{id}/claim-owner` | POST | MemberOf | new token | owner link | — |
| Co-owner invite / redeem | My Team, /join-co-owner | `/leagues/co-owner-invite`, `/leagues/co-owner-invites/redeem` | POST | Session | code / token | owner link | — |
| Rename league / roles / remove | /leagues, Commish | `/leagues/{id}`, `/leagues/{id}/members/{uid}` | PATCH/DELETE | CommishOf | — | league | — |
| Your Week hero | Home | `/me/week` | GET | ActiveLeague | `YourWeek` | — | 45 s page refresh on game day |
| Standings | Home, Standings | `/seasons/{s}/standings` | GET | LeagueRead | `StandingsRow[]` | — | — |
| Weekly matchups (full) | Home, Standings, Matchup | `/seasons/{s}/weeks/{w}/matchup-context` | GET | LeagueRead | `WeekMatchupContext` | — | 45 s refresh on game day |
| Single matchup | Matchup | `/matchups/{id}` | GET | LeagueRead | `WeekMatchupContextItem` | — | — |
| Scoreboard paging | Standings › Scoreboard | `/seasons/{s}/weeks/{w}/matchup-context` | GET | LeagueRead | same | — | — |
| Playoff bracket / projection | Standings › Playoffs | `/seasons/{s}/playoffs/bracket`, `/projected` | GET | LeagueRead | nodes / matchups | — | — |
| Power rankings | Home, League, Standings, PR | `/seasons/{s}/weeks/{w}/power-rankings`, `/latest-week`, `/trend`, `/power-rankings/all-time` | GET | LeagueRead | rankings | — | — |
| Rivalries | Home, Rivalries | `/rivalries` | GET | LeagueRead | `Rivalry[]` | — | — |
| League ticker | Home, all app pages | `/seasons/{s}/weeks/{w}/ticker` | GET | LeagueRead | items | — | 45 s refresh |
| NFL ticker / scores | global | `/nfl/scoreboard`, `/nfl/live-games` | GET | Public | games | — | 45 s refresh |
| Weekly awards | Home | `/seasons/{s}/weeks/{w}/awards` | GET | LeagueRead | `WeeklyAwards` | — | — |
| AI weekly recap | Home | `/seasons/{s}/weeks/{w}/recap`, `/recap/generate` | GET/POST | LeagueRead / ActiveCommish | narrative | generates | — |
| Season awards / records / leaderboards | Awards pages | `/seasons/{s}/awards`, `/records`, `/awards/all-time` | GET | LeagueRead | categories | — | — |
| Draft recap / grades | Season Draft, Owner | `/seasons/{s}/draft-grades`, `/seasons/{s}/owners/{id}/draft-grade` | GET | LeagueRead | grades | — | — |
| Owner cards / profile | Player Cards, Owner | `/owners`, `/owners/{id}/career\|badges\|profile` | GET | LeagueRead | profiles | — | — |
| Team roster by week | Team | `/teams/{id}`, `/teams/{id}/roster?week=` | GET | LeagueRead | `TeamRoster` | — | — |
| League activity | Home, Activity | `/seasons/{s}/activity` | GET | LeagueRead | items | — | — |
| League poll | League | `/leagues/{id}/polls`, `/vote` | GET/POST | MemberOf | `Poll[]` | vote | — |
| My roster | My Team | `/me/team`, `/me/team/ownership` | GET | HasTeam | `MyTeam` | — | 15 s poll on game day |
| Lineup move / swap | My Team | `/me/team/lineup/move`, `/swap` | POST | HasTeam | `{roster}` | lineup | — |
| Drop player | Player card | `/me/team/lineup/drop` | POST | HasTeam | `{roster}` | roster + waiver clock | — |
| NFL player card | global modal | `/players/{id}/card` | GET | ActiveLeague | `PlayerCard` | — | — |
| Free agent list | Free Agents | `/me/team/free-agents` | GET | ActiveLeague | `MyFreeAgent[]` | — | — |
| Add free agent | Free Agents | `/me/team/free-agents/add` | POST | HasTeam | `{roster, dropped_player}` / 409 variants | roster | — |
| Waiver claim / cancel / list | Free Agents | `/me/team/waivers/claim`, `/cancel`, `/me/team/waivers` | POST/GET | HasTeam | `WaiverClaim` | claim | processed by scheduler |
| Waiver order & mode | Free Agents | `/seasons/{s}/waivers/priority`, `/free-agents/waiver-settings` | GET | LeagueRead / Public | order, faab flag | — | — |
| Trades | Trades | `/trades/teams`, `/trades/teams/{id}/roster`, `/trades/mine`, `/trades`, `/trades/{id}/accept\|reject\|cancel` | GET/POST | HasTeam | `Trade[]` | trade | — |
| Trade review & settings | Commish › Trades | `/trades/pending`, `/trades/{id}/review`, `/trades/settings` | GET/POST/PUT | ActiveCommish | trades, settings | approve/veto | — |
| Keepers | Keepers | `/keepers/me` | GET/PUT | ActiveLeague | `MyKeepers` | selections | — |
| Keeper rules | Keepers, Commish › Roster | `/keepers/rules`, `/lock`, `/unlock` | GET/PUT/POST | ActiveCommish (write) | `KeeperRules` | rules | auto-lock scheduler |
| Draft room state | Draft | `/draft/state`, `/draft/pool`, `/draft/queue*` | GET/POST/PUT/DELETE | ActiveLeague | `DraftState`, pool, queue | queue | `/draft/ws` events → refetch |
| Make pick | Draft | `/draft/pick` | POST | ActiveLeague (on the clock) | `{pick, config}` | pick | broadcast `pick_made` |
| Draft room chat | Draft | `/draft/ws` (`chat`) | WS | Ticket(ws) | message | message | WS |
| Draft setup & controls | Draft (commish) | `/draft/setup\|schedule\|order\|roster-slots\|position-max\|seed-keepers\|start\|pause\|resume\|undo-last-pick\|reset` | POST/PUT | ActiveCommish | state/config | draft | broadcasts |
| Chat conversations | Chat, unread badge | `/chat/conversations` | GET | ActiveLeague | `ChatConversation[]` | — | `/chat/ws` message events |
| Message history | Chat | `/chat/conversations/{id}/messages` | GET | participant | `ChatMessage[]` | — | — |
| Send message / typing | Chat | `/chat/ws` | WS | Ticket(ws) | — | message | WS broadcast |
| Read / react / delete | Chat | `/chat/conversations/{id}/read`, `/chat/messages/{id}/react`, `DELETE /chat/messages/{id}` | POST/DELETE | participant | — | yes | WS broadcast |
| DMs & members | Chat | `/chat/conversations/direct`, `/chat/members`, `/chat/conversations/{id}/members` | POST/GET | ActiveLeague | ids / members | DM | presence via WS |
| GIF search | Chat | `/chat/gifs` | GET | Session | `ChatGif[]` | — | — |
| Image attach | Chat, Feedback, Logo | Next `/api/chat/upload`, `/api/settings/logo-upload` (Vercel Blob) | POST | frontend cookie | blob URL | upload | — |
| Presence (online dots) | Chat, members | `/chat/ws` presence events | WS | Ticket(ws) | `{owner_id, online}` | — | WS |
| Watch Party rooms | Chat | `/watch-party/rooms*`, `/token` | GET/POST/DELETE | ActiveLeague | rooms, LiveKit token | rooms | LiveKit + `/watch-party/ws` |
| Fantasy digest in party | Watch Party | `/watch-party/ws` | WS | Ticket(watch_party_ws) | `fantasy_digest` | — | WS |
| Lounge | Lounge | `/lounge/rooms*`, `/join` | GET/POST/DELETE | Session / Public | rooms, LiveKit token | rooms | LiveKit |
| Gamecast hub | Gamecast | `/nfl/scoreboard`, `/nfl/live-games` | GET | Public | games | — | — |
| Gamecast game | Gamecast game | `/nfl/games/{id}` | GET | Public | `LiveGame` | — | `/nfl/gamecast/ws` `game_state` |
| Fantasy impact | Gamecast game | `/nfl/games/{id}/fantasy-impact` | GET | Public (cookie-personalized) | impact | — | polled |
| Chug leaderboard / feed / deadline | Chug, Home | `/chug/leaderboard`, `/chug/feed`, `/chug/deadline`, `/chug/seasons`, `/chug/{id}/video` | GET | LeagueRead | chug data | — | — |
| Chug upload | Chug | `/chug/upload` | POST multipart | Session / Ticket(chug_upload) | streamed JSON | chug | — |
| Chug commissioner actions | Chug | `/chug/standing/{owner}/clear-fine\|record-payment\|waive-doubling` | POST | ActiveCommish | counts | standing | — |
| Profile settings | Settings › Profile | `/settings/me`, `/settings/display-name*`, `/chat-color`, `/logo`, `/team-name*` | GET/PUT/POST | Session | `MySettings` | profile | — |
| Preferences | Settings, Home deck, Nav | `/settings/preferences`, `/sunday-mode` | GET/PUT/POST | Session | `OwnerPreferences` | prefs | — |
| Web push | Settings › Notifications | `/push/vapid-public-key`, `/push/subscribe`, `/push/unsubscribe`, `/push/test` | GET/POST | Session | — | subscription | push |
| Native push | Capacitor | `/push/native/register` | POST | Session | — | device | push |
| Feedback | Settings › Feedback | `/feedback` | POST/GET | Session / ActiveCommish | items | feedback | — |
| Scoring rules | Commish › Scoring | `/league/scoring-rules` | GET/PUT | ActiveLeague / ActiveCommish | rules | rules | — |
| Playoff settings | Commish › League | `/league/playoff-settings` | GET/PUT | ActiveLeague / ActiveCommish | settings | settings | — |
| Roster slots / position max | Commish › Roster | `/draft/roster-slots`, `/draft/position-max` | GET/PUT | ActiveLeague / ActiveCommish | slots | slots | — |
| Force-edit roster | Commish › Roster | `/leagues/{id}/teams/{team}/roster*` | GET/POST | CommishOf | roster | roster | — |
| Polls management | Commish › Polls | `/leagues/{id}/polls`, PATCH close | POST/GET/PATCH | CommishOf | `Poll[]` | polls | — |
| ESPN connection | Commish › ESPN | `/league/espn-connection*` | GET/POST/DELETE | ActiveCommish | status | connection/sync | — |
| Analytics | global | `/admin/track` | POST | Session | — | event | — |
| Admin dashboard | Admin | `/admin/overview\|timeseries\|features\|activity\|alerts\|system-health\|online\|navigation\|users*\|leagues*` | GET/PATCH/DELETE | SiteAdmin | metrics | user admin/delete | client polling |

---

## 13. WebSocket / Real-Time Architecture

### 13.0 Shared connection recipe (all four sockets)

1. `POST /auth/ticket?purpose=<p>` with the session (Bearer works) → `{ticket}`. Purposes: chat/draft/gamecast = `ws` (valid 60 s — **mint immediately before connecting and re-mint on every reconnect**); Watch Party = `watch_party_ws` (6 h).
2. Open `wss://<backend>/<path>?ticket=<ticket>&<params>` (convert `http`→`ws` on the backend base URL). WS endpoints also accept the `session` cookie, but **do not accept an Authorization header**.
3. Close codes: `4401` = unauthenticated / no owner / no active league (draft) → **do not reconnect**; `4404` = resource missing (no draft configured, unknown game, room inaccessible) → do not reconnect; `4409` = watch party league resolution failed. Any other close → reconnect after **2 s** fixed delay (current clients; no exponential backoff, no max attempts).
4. No heartbeat/ping frames are sent by either side (relies on TCP/proxy keepalive). **UNKNOWN — requires verification:** idle-timeout behavior behind the production proxy.

### 13.1 Chat + presence — `WS /chat/ws?ticket=`

- **Opened by:** `PresenceProvider` (app-wide, every page when signed in) **and** `ChatApp` (second socket while on /chat). Both are independent connections.
- **Server auth:** ticket `ws` → `resolve_owner_id`; no owner → close 4401. Connection registered per owner.
- **Client → server:**

| type | payload | effect |
|---|---|---|
| `visibility` | `{visible: boolean}` (send on open and on `visibilitychange`) | server skips push notifications for owners with a *visible* connection |
| `message` | `{conversation_id, body, mentions:number[], reply_to_id:number\|null, image_url:string\|null, title?:string}` | persisted + broadcast. Body ≤2000 chars (≤20000 in commish_corner); empty body allowed only with valid image; `image_url` must be a Vercel Blob or `*.giphy.com` https URL; `title` required (≤200) in commish_corner, and only that league's commissioner may post |
| `typing` | `{conversation_id}` | broadcast to other participants if sender has typing indicators on |

Invalid frames, non-participant conversation ids, and over-length messages are **silently dropped**.

- **Server → client:**

| type | payload | UI reaction (current) |
|---|---|---|
| `presence` | `{owner_id, online}` (broadcast to **all** connected owners on connect/disconnect) | update online dot map (`usePresence`) |
| `message` | `{message: ChatMessage}` | append to conversation (dedupe by id, cap 200 in memory), update `last_message`, increment `unread_count` unless open or mine, re-sort list, mark read if open |
| `typing` | `{conversation_id, owner_id, owner_name}` | show typing indicator, auto-clear after 3 s |
| `reaction` | `{message_id, conversation_id, emoji, owner_id, owner_name, added}` | increment/decrement reaction counts and names |
| `read` | `{conversation_id, owner_id, last_read_message_id}` | update DM `other_last_read_message_id` → "Seen" |
| `deleted` | `{message_id, conversation_id}` | remove message from list |
| `error` | `{error: "commish_corner_restricted"\|"commish_corner_title_required", conversation_id}` | **not handled by current UI** (§27) |

- **Send behavior:** if the socket is not OPEN, `sendMessage` silently does nothing (no queue, no error). Base44 should disable the send button or queue while disconnected.
- **History:** REST `GET /chat/conversations/{id}/messages?before=<oldest id>` pages of 50.

### 13.2 Draft room — `WS /draft/ws?season=<config.season>&ticket=`

- **Opened by:** `DraftRoom` once a draft state with a season is loaded.
- **Server auth:** ticket `ws`; requires active league and owner (else 4401). If no draft config: sends `{type:"error", detail:"No draft configured for this season"}` then closes 4404.
- **On connect server sends:** `{type:"draft_state", config, picks, connected_owner_ids, chat_messages}`.
- **Client → server:** only `{type:"chat", text}` (1…MAX length, trimmed). Everything else ignored. Picks go through REST `POST /draft/pick`.
- **Server → client events:** `presence {owner_id, online}`, `chat {message: DraftChatMessage}`, `pick_made {pick, config}`, `pick_undone {undone_pick, config}`, `draft_status {config}` (start/pause/resume, auto-start, clock), `draft_reset`, `keeper_seeded`, `keepers_seeded`, `draft_state`, `error`.
- **Current UI reaction:** `presence` → update connected set + presence log; `chat` → append (cap 200); **any other event → refetch `GET /draft/state`, `GET /draft/pool`, `GET /draft/queue`** (the payloads are not applied directly). Local 1 s countdown ticks from `config.current_pick_deadline`; `paused_remaining_seconds` shown when paused.
- **Autopick:** server-side (`draft_clock` scheduler, 2 s tick, 5 s grace) uses the owner's queue first, then best available by `search_rank` with position guardrails. The UI only displays `is_autopick`.

### 13.3 Gamecast — `WS /nfl/gamecast/ws?game_id=&ticket=`

- **Opened by:** `GamecastShell` only when status ∈ {in_progress, halftime, scheduled} **and** a ticket can be minted (signed in). Signed-out visitors get the SSR snapshot only (the code comment promises a REST-poll fallback that is **not implemented** — §27).
- **On connect:** `{type:"game_state", game: LiveGame}` (or `error` + close 4404 for unknown game).
- **Server pushes:** `game_state` on each scheduler poll (default every 4 s, only while at least one client is connected and a game is live; requires `ENABLE_GAMECAST_SCHEDULER`), plus `fantasy_impact {player_name, pro_team, owner_id, owner_name, team_name, points_scored, delta}` events when rostered players' points change — **currently ignored by the UI**.
- **Client → server:** nothing meaningful (reads are ignored).
- **UI:** replace whole `game` state; "updated Ns ago" recomputed every 1 s from `last_updated`; connection indicator in `GameHeader`. `FantasyImpact` separately polls `GET /nfl/games/{id}/fantasy-impact` while live.

### 13.4 Watch Party digest — `WS /watch-party/ws?room_id=&ticket=`

- **Opened by:** `FantasyTicker` inside `WatchPartyRoom`. Ticket purpose `watch_party_ws` (6 h).
- **Server:** requires active league; room must be in league, open, and (private) include caller; adds caller to the room's chat conversation. Sends one `fantasy_digest` on connect, then every Watch Party scheduler poll (30 s, requires `ENABLE_WATCH_PARTY_SCHEDULER`, only during live NFL games).
- **Payload:** `FantasyDigest {type:"fantasy_digest", season, week, matchups:[{matchup_id, home:{team_name, owner_name, score}, away:{…}, sweat:{score, label}}]}`.
- **Room chat** uses the normal chat WS with the room's `conversation_id`.

### 13.5 Other real-time / live mechanisms

| Mechanism | Where | Detail |
|---|---|---|
| LiveKit | Watch Party (`@livekit/components-react` `<LiveKitRoom>` + `<VideoConference>`), Lounge (custom layout with `useTracks`/`VideoTrack`/`Chat`) | token from `POST /watch-party/rooms/{id}/token` or `POST /lounge/rooms/{slug}/join` → connect directly to `url` (LIVEKIT_URL). Custom screen-share requests system audio. |
| Page refresh polling | `GameDayRefresher` | `router.refresh()` every 45 s during live NFL games, visible tab only |
| Roster polling | `MyTeamApp` | `GET /me/team` every 15 s, live game + editable week + visible |
| Fantasy impact polling | `FantasyImpact` | interval while game live |
| Admin polling | `AdminOverview` | online owners + overview on intervals |
| Lounge NFL sidebar | `LoungeNflSidebar`, `LoungeVideoRoom` | `/nfl/scoreboard` every 30 s |
| Countdown clocks | `DraftCountdownCard`, `ChugCountdownCard`, `KeepersPanel`, draft pick clock | 1 s client ticks, no network |
| Web Push | `public/sw.js` | `push` → `showNotification`; `notificationclick` → open/focus payload `url` (e.g. `/chat?conversation=ID`, `/gamecast/ID`) |
| Native push | APNs/FCM | registered via `NativePushRegistration` |
| Push event producers (server) | `notifications/chug_events.py`, `draft_events.py` (on the clock, draft live, starting soon, room open), `fantasy_events.py` (touchdowns, lead changes), chat messages (mentions/replies/DMs/league/commish corner) | respect `owner_preferences` toggles, Sunday Mode, quiet hours |

---

## 14. Data Entities

Only entities the UI consumes. Identifiers as exposed by the API.

| Entity | Identifier | Key fields exposed | Relationships | Screens | Endpoints |
|---|---|---|---|---|---|
| User (account) | `user_id` | display_name, email, has_discord/google/password, is_admin, token_version (server), active_league_id | 1 user ↔ 0..1 owner (via `owner_users`, multiple users can share one owner = co-owners) | Auth, Settings, Admin | `/auth/me`, `/settings/me`, `/admin/users*` |
| Owner (league identity) | `owner_id` | display_name, chat_color, logo_url, discord_user_id | owns teams across seasons; chat participant | everywhere | `/owners*`, chat |
| League | `id` (`league_id`) | name, invite_code, created_at, role (for caller) | members (users), teams, settings | Leagues, Commish, Admin | `/leagues*` |
| LeagueMember | (`league_id`,`user_id`) | role commissioner/member, joined_at, display_name | | Leagues, Members | `/leagues/{id}/members` |
| Team (team-season) | `team_id` | season, team_name, owner_id, owner_name, espn_team_id, league_id | one per owner per season per league | Standings, Team, Trades | `/seasons/{s}/teams`, `/teams/{id}` |
| Player (NFL) | `sleeper_player_id` (string); `espn_player_id` (number, optional crosswalk) | full_name, position (QB/RB/WR/TE/K/DEF), pro_team, injury_status, search_rank, projections, bye_week, headshot | rostered via current_rosters | Roster, FA, Draft, Card | `/players/{id}/card`, `/draft/pool`, `/me/team/free-agents` |
| Roster entry (current) | (`team_id`,`sleeper_player_id`) | lineup_slot, acquired_via, points, live_projected, is_locked, on_offense, is_redzone | | My Team, Commish | `/me/team`, commissioner roster |
| Roster (historical week) | (`team_id`,`week`) | `RosterPlayer` fields incl. raw_stats, game_status, boom/bust | | Team, Matchup | `/teams/{id}/roster`, matchup-context |
| Matchup | `matchup_id` | season, week, is_playoff, home/away sides, scores, projections, win_probability, rivalry, head_to_head | 2 teams | Home, Matchup, Scoreboard | `/matchups/{id}`, matchup-context |
| Standings row | `team_id` | W/L/T, PF, PA, final_rank | | Standings | `/seasons/{s}/standings` |
| Power ranking | (`team_id`,`week`) | power_rank, luck_score, sos, movement | | PR, badges | power-rankings routes |
| Playoff bracket node | `id` | round, slot, seeds, teams, scores, winner, weeks_played | | Standings › Playoffs | bracket |
| Scoring rule | (`league`,`season`,`stat_category`) | points_per_unit | | Commish › Scoring | `/league/scoring-rules` |
| Draft config | (`season`,`league`) | draft_type, pick_time_limit_seconds, draft_order (owner ids), roster_slots, status, current_pick_number/deadline, scheduled_start, paused_remaining_seconds | picks | Draft | `/draft/state` |
| Draft pick | `pick_number` | round, round_pick, owner, player, is_autopick, is_keeper, made_at | | Draft, recap | `/draft/state`, draft-grades |
| Draft queue | owner+season | ordered sleeper ids | | Draft | `/draft/queue` |
| Draft grade / narrative | owner+season | letter_grade, percentile, projected points; narrative text | | Draft recap, Owner | draft-grades |
| Keeper rules / selection | season+league / id | max_keepers, max_consecutive_years, deadline, locked_at, is_open; selection espn_player_id, consecutive_years_kept | | Keepers | `/keepers/*` |
| Waiver claim | `id` | add/drop player, status pending/successful/failed/cancelled, failure_reason | | Free Agents | `/me/team/waivers*` |
| Waiver wire state | player | `waiver_clears_at`, `game_locked` (on FA rows) | | Free Agents | FA list |
| Trade (+assets) | `id` | proposing/receiving team, status, proposed/resolved_at, assets (player, from/to team) | | Trades | `/trades*` |
| Trade settings | season+league | trade_deadline, review_required | | Commish › Trades | `/trades/settings` |
| Conversation | `id` | type league/direct/commish_corner, unread_count, last_message, can_post, avatar_group | participants (owners) | Chat | `/chat/conversations` |
| Message | `id` | body, title, image_url, reply_to, mentions, reactions, seen_by, deleted | | Chat | messages, WS |
| Draft room message | `id` | owner, text, created_at | | Draft | draft state/WS |
| Watch party room | `id` | name, kind open/private, conversation_id, is_live, member_count | | Chat | `/watch-party/*` |
| Lounge room | `id`, `slug` | name, closed | | Lounge | `/lounge/*` |
| Poll | `id` | question, options, status, results, my_vote | | League, Commish | polls |
| Chug (score) | `id` | owner, week, final_score, has_video, roast | | Chug, Home | `/chug/feed` |
| Chug standing | owner+season | owed, completed, outstanding_owed, fined_owed, fine_amount, doubled_weeks | | Chug | `/chug/leaderboard` |
| Rivalry | `id` | name, emoji, tagline, description, tier, wins | 2 owners | Rivalries, Matchup | `/rivalries` |
| Awards / records | category keys | award_type/detail/owner; record entries | | Awards | awards routes |
| Weekly narrative | season+week | text, kind preview/recap | | Home | recap |
| Owner preferences | owner | see `OwnerPreferences` | | Settings, nav, home | `/settings/preferences` |
| Push subscription / device | endpoint / device_id | device_label, platform, active | | Settings | `/push/*` |
| Feedback | `id` | submitted_by, message, page_url, image_url | | Settings › Feedback | `/feedback` |
| ESPN connection | league | espn_league_id, last_synced_at, last_sync_error | | Commish › ESPN | `/league/espn-connection` |
| Analytics event | — | event_name, event_type, route, metadata | | (write-only) | `/admin/track` |

---

## 15. Business Rules Affecting UI

Format: **BE** (enforced server-side — never re-implement as authority) → **FE** (what the UI shows/does).

### 15.1 League scoping & roles
- **BE:** All league data resolves from `users.active_league_id`; `POST /leagues/{id}/select` requires membership. Commissioner checks are live per league. Multiple commissioners allowed; you cannot change/remove your own role; account deletion blocked for league creators/sole commissioners.
- **FE:** After switching league, invalidate every cached league query. Hide commissioner UI unless `me.is_commissioner` (active league) — but still handle 403. Show admin UI only when `me.is_site_owner`.

### 15.2 Lineups (`domain/lineup_engine.py`, `roster_slots.py`, `ir_rules.py`)
- **BE:** Slots: QB, RB, WR, TE, RB/WR/TE (FLEX: RB/WR/TE only), D/ST (DEF), K, BE, IR. Capacity from `draft_config.roster_slots` (default `{QB:1,RB:2,WR:2,TE:1,"RB/WR/TE":1,"D/ST":1,K:1,BE:7,IR:1}`). IR only for injury_status ∈ {IR, PUP, OUT, NA, COV, DNR}; an IR player whose status improves blocks new acquisitions until moved. IR does not count toward the roster limit. Any move/swap touching a player whose NFL game has kicked off this week → 409 (**lineup lock at kickoff**). Moves only affect the live current week. Commissioner force-moves skip the kickoff lock.
- **FE:** Use `is_editable` to hide all edit affordances on non-current weeks; show "Locked" pill for `is_locked`; only offer destinations that are eligible (use `lib/rosterSlots.ts` for **display filtering only**), have capacity, and whose occupant isn't locked; show server `detail` on failure.

### 15.3 Free agents & waivers (`domain/waivers.py`)
- **BE:** Standard (priority) waivers; priority resets weekly to inverse standings; winning a claim moves you to the back. A **dropped** player is on waivers for 1 day (`DROP_WAIVER_PERIOD`). A never-dropped player whose NFL game has kicked off becomes "game-locked" and clears the next **Wednesday 3:00 AM ET**. Adding such a player → 409 `on_waivers` (the attempt itself may start the clock). Roster full → 409 `roster_full` (retry with a drop). Claims processed by the waiver scheduler (hourly by default). FAAB flag comes from ESPN league settings (display only; no bid field exists in claims).
- **FE:** For rows with `waiver_clears_at` or `game_locked`, show "Claim" instead of "Add" with explanatory tooltip; handle both 409 variants via their `error` field; show claim status list with cancel for `pending`.

### 15.4 Trades (`domain/trades.py`)
- **BE:** Two-team, player-for-player only (no picks/FAAB). Ownership & roster capacity validated at proposal and again at acceptance/approval. If `review_required`, accept → `awaiting_review`, then commissioner approve → `accepted` or veto → `vetoed`. Trade deadline stored per season and enforced on **both** proposing and accepting (`_assert_before_deadline`). Only the receiving team responds; only the proposer cancels.
- **FE:** Show Accept/Reject to receiver and Cancel to proposer on `pending`; status labels; commissioner review queue.

### 15.5 Draft (`domain/draft_engine.py`, `draft_autopick.py`)
- **BE:** Snake order pre-generated at setup; keepers pre-occupy their round's pick; pick timer **90 s in round 1, 60 s in later rounds** (`ROUND_1_PICK_SECONDS`/`LATER_ROUND_PICK_SECONDS`; the setup form's `pick_time_limit_seconds` is stored but does not drive the clock), autopick on expiry (+5 s grace) from queue then best-available by Sleeper `search_rank` with positional guardrails and `position_max`; auto-start at `scheduled_start`; statuses not_started/in_progress/paused/complete; undo last pick; reset wipes picks and rosters. Roster slots are locked once a draft exists.
- **FE:** Enable "Draft" only when `isMyTurn` (`current pick owner === my owner_id && status === in_progress`); show clock; mark drafted players; confirm destructive commissioner actions.

### 15.6 Keepers (`routers/keepers.py`)
- **BE:** Pool = your team's **prior-season ESPN roster**; max keepers; max consecutive years (eligibility computed); open iff not locked and before deadline; auto-lock job ~1 h before draft; commissioner lock/unlock.
- **FE:** Disable ineligible rows, enforce max in the picker (server re-validates), read-only states, lock countdown.

### 15.7 Scoring & live numbers
- **BE:** Scoring engine (`domain/scoring_engine.py`) computes player points from stat lines × league `league_scoring_rules`; live projections (`live_projection.py`), win probability (`win_probability.py`), boom/bust, bench crimes, clutch/choke, expected score, power ranks (locked at week flip), awards — all server-computed.
- **FE:** Display only. Never recompute points/projections/win% client-side. `points_for`/`points_against` arrive as strings; most other numbers as JSON numbers.

### 15.8 Week lifecycle (`domain/week_flip.py`)
- **BE:** Fantasy week flips at **2:00 PM Central on the Tuesday** after the week's last NFL game (requires all games final); power ranks lock at the flip; weekly recap auto-generated at settlement. `current_week` comes from cached `league_state`.
- **FE:** Weekly awards/recap fall back to the previous week until the new week has data (Home already does this). Treat `current_week` null/0 as week 1.

### 15.9 Playoffs (`domain/playoffs.py`)
- **BE:** Single elimination, power-of-2 team count only, configurable weeks per matchup and start week; bracket generated/resolved by ops endpoints (no UI trigger). Projected picture only until a real bracket exists.
- **FE:** Show playoff line only for in-progress seasons; show bracket when nodes exist else projection.

### 15.10 Chug / Jeffrey's Rule (`domain/chug_standing.py`)
- **BE:** Any active (non-bench, non-IR) roster spot scoring ≤0 owes one chug; unpaid by MNF kickoff → balance doubles, max 3 consecutive doublings, then converts to a $10/chug fine only a commissioner can clear. Upload is graded by a CV pipeline (can_to_mouth detection) — requires linked Discord owner (409 otherwise).
- **FE:** Display balances; commissioner action buttons; upload progress with streamed result.

### 15.11 Chat
- **BE:** League + Commish's Corner conversations auto-created per league; DMs only between current league members; Commish's Corner: commissioner-only posting with required title; reactions limited to 6 emoji; delete own messages only (soft delete); read receipts/typing respect each sender's prefs; push suppressed when recipient has a visible socket.
- **FE:** Lock composer when `can_post === false`; announcement title field for commissioners; hide typing/receipts per prefs.

### 15.12 Account & identity
- **BE:** Password ≥8 chars; display/team names ≤40 chars, no control characters; hex colors `#rrggbb`; logo/image URLs must be Vercel Blob (or GIPHY) https URLs; Discord login only for Discord IDs already linked to an owner.

---

## 16. Forms and Validation

Client-side validation in the current UI is minimal; the backend is authoritative. Replicate these server rules as inline hints and always render `detail` on error.

### 16.1 Auth & onboarding

| Form | Fields | Client checks (current) | Server rules |
|---|---|---|---|
| Sign in | email (type=email, required), password (required) | HTML required | 401 invalid; 429 rate limit |
| Sign up | display name (required), email, password, confirm | passwords match ("Passwords don't match") | email contains `@`, length ≥5; password ≥8; name non-empty; 409 duplicate |
| Forgot password | email | required | generic message |
| Reset password | new password (+confirm) | match | ≥8; token valid 1 h |
| Create league | name | non-empty trim | non-empty (create has no length cap; rename ≤40) |
| Join league | invite code | non-empty trim | 404 unknown |
| Create team | team name | non-empty | non-empty; 409 already has team |
| Rename league | name | maxLength 40, non-empty | ≤40 |
| Co-owner code | code | — | 409 used/invalid |

### 16.2 Team management

| Form | Fields | Rules |
|---|---|---|
| Lineup edit | destination tap | server lineup rules (§15.2) |
| Add FA / claim | optional drop selection | §15.3 |
| Trade proposal | partner team, give[] (≥1), receive[] (≥1) | button disabled until both non-empty; server validation |
| Keepers | checkbox set ≤ max_keepers | server re-validates |
| Draft queue | add/remove/reorder | — |

### 16.3 Settings & preferences (`PUT /settings/preferences` validation)

| Field | Allowed |
|---|---|
| `neon_intensity` | subtle, standard, high |
| `theme` | calm, cosmic |
| `design_direction` | default, broadcast, stadium |
| `accent_color`, `your_week_color`, `border_glow_color`, `chat_color` | `^#[0-9a-fA-F]{6}$` or null |
| `home_card_order` | JSON-encoded array, unique keys ⊆ {yourWeek, standings, powerRankings, matchups, rivalries, awards, chugFeed, activity, discover} |
| `bottom_nav_order` | JSON-encoded array containing **exactly** {team, league, home, matchups, gamecast, chat} (6 keys) — frontend sends 5 (§27 C1) |
| `home_hidden_cards`, `home_desktop_layout` | accepted but unused by UI |
| `quiet_hours_start/end` | time strings |
| booleans | notify_direct_messages, notify_league_chat, notify_mentions, notify_replies, notify_game_alerts (not exposed in UI), notify_my_players, notify_fantasy_team, notify_league, quiet_hours_enabled, read_receipts_enabled, typing_indicators_enabled, message_previews_enabled, mention_highlighting_enabled, reduced_motion, beta_layout, ai_training_opt_out, ai_training_notice_seen |
| `push_enabled` | **server-managed** (set by push subscribe/unsubscribe) — do not send |

Profile: display name / team name 1–40, no control chars; logo via cropper (canvas → PNG, ≤2 MB, jpeg/png/webp accepted at token route).

### 16.4 Commissioner

| Form | Fields | Rules |
|---|---|---|
| Playoff settings | playoff_team_count (>0, bracket needs power of 2), weeks_per_matchup (>0, default 1), start_week (optional) | 400 on ≤0 |
| Scoring rules | `{stat_category: number}` | numbers |
| Roster slots | per-slot integer counts | locked once draft exists (409) |
| Position max | per-position integer | always editable |
| Keeper rules | max_keepers ≥0, max_consecutive_years ≥1 or null, keeper_deadline (datetime-local → ISO) | 409 when locked |
| Trade settings | trade_deadline (datetime-local → ISO or null), review_required | — |
| Draft setup | order (owner ids), roster slots (defaults above), pick seconds (default 90) | 409 exists |
| Draft schedule | datetime-local → `new Date(v).toISOString()` | — |
| Poll | question (non-empty), options (≥2 non-empty) | 400 |
| ESPN connection | league id (number), ESPN_S2, SWID | 400 if credentials fail a live check |
| Recap generate | force flag | status enum explains no-op |

### 16.5 Chat, uploads, feedback, lounge

| Form | Rules |
|---|---|
| Message | ≤2000 chars (≤20000 announcements), image optional; announcement title ≤200 required; mentions must be participants |
| Image upload | Blob token route: jpeg/png/webp/gif, ≤8 MB (chat & feedback); logos jpeg/png/webp ≤2 MB |
| Chug upload | .mp4/.mov/.m4v, ≤500 MB, ≤15 min transfer window |
| Feedback | message or image required |
| Lounge create | name required, password ≥8, display name ≤40 printable |
| Lounge join | password (non-hosts), display name required for guests |
| Watch party | name required, invited owners must be league members |
| GIF search | 1–100 chars |

---

## 17. Loading / Empty / Error States

### 17.1 Global handling (current)

| Condition | Current handling |
|---|---|
| Signed out on protected page | `SignInCard` inline (no redirect) |
| No active league | `NeedsLeagueCard` (→ `/leagues`) |
| Not commissioner | paragraph "Commissioner tools are only visible to your league's commissioner." |
| Not site admin | "Not authorized. This page is only visible to the site owner." |
| 404 entity (matchup, team, season draft) | Next `notFound()` → global 404 page |
| Uncaught server/render error | `error.tsx` "Something went wrong" + Try again / Go home |
| SSR 401/403/404/409 via `getServerOrNull` | treated as `null` → the page's null state |
| SSR other non-2xx via `getServer` | throws → `error.tsx` |
| Client mutation errors | `throw new Error(data?.detail ?? "<Action> failed (status)")` → inline red text near the control |
| Revoked session (401 from middleware) | same as signed out on next request; no global interceptor |
| Offline | `OfflineBanner` + SW serves last cached `/api/backend/*` GET |
| WS disconnect | chat: `connected=false` (UI indicator), auto-reconnect 2 s; draft chat input placeholder "Reconnecting…"; gamecast connection indicator |
| External feed failure | NFL scoreboard/live games return `[]` (ticker empty, never breaks page); league ticker `{items:[]}`; fantasy impact `null` |
| Timeouts | no explicit client timeouts anywhere (**gap**) |
| 422 | not specially handled (detail is an array → shown as generic message) |
| 409 variants | handled explicitly for FA add (`roster_full`, `on_waivers`), commissioner add, seed keepers (`unresolved`), admin delete (`blockers`) |

### 17.2 Loading states
Most pages are server-rendered (no spinner; Next shows nothing until ready — no `loading.tsx` files exist). Client components use text: "Loading…", "Loading your team…", "Loading draft…", "Loading your claims…", "Signing you in…". Buttons switch labels while busy ("Saving…", "Adding…", "Proposing…", "Working…", "Switching…", "Claiming…", "Joining…", "Dropping…", "Generating…", "Starting…", "Cancelling…").

### 17.3 Empty states (verbatim copy to reuse)

| Screen | Copy |
|---|---|
| Leagues | "You're not in any leagues yet — create one or join with an invite code below." |
| Your Week | "No matchup yet — the season hasn't started." / "No matchup this week (bye week or the schedule isn't set yet)." / "You're signed in, but not on a team yet." |
| Power Rankings card | "Power rankings will appear here once this week's games have been played." |
| My Team | "Your roster is empty — the draft hasn't happened yet." |
| Free Agents | "No free agents found." |
| Trades | "No other teams in this league yet." / "No trades yet." |
| Draft | "No draft has been set up yet." / "The draft hasn't been scheduled yet — check back soon." / "No messages yet — say hi." |
| Rivalries | "No rivalries recorded." |
| Awards | "No awards recorded for {season} yet." |
| Season draft | "Draft grades haven't been computed for {season} yet — they appear automatically shortly after the real draft finishes." |
| Chug | "No chug data yet." |
| Activity | "No activity yet." |
| Team | "No roster data for week N." |
| Standings › Scoreboard | "No schedule yet." |
| Gamecast hub | "No games scheduled right now" + explanation |
| Gamecast game | "Game not found — This game either hasn't started, has already been archived, or the link is wrong." |
| Lounge | "Lounge not found" / "This lounge has been closed by its host." |
| Admin | "Couldn't load the overview — try refreshing." (and per page) |

### 17.4 Edge cases to support explicitly
Expired/revoked session mid-use (401 on any call → sign-in); league switched in another tab; team missing for active season (404 "No team found for this owner"); pre-draft empty rosters; bye weeks (no matchup); week 0/preseason; player locked mid-edit (409); player hits waivers between list load and add (409 on_waivers); roster full (409); trade invalidated before acceptance (400/409); poll closed before vote (409); draft pick when not your turn (409); draft reset while viewing (`draft_reset` event → refetch → 404 → setup view); WS 4401 (stop reconnecting); keeper deadline passing while page open (`is_open` false after refetch); Commish's Corner posting by non-commissioner (silent WS drop / error frame).

---

## 18. Responsive / Mobile Behavior

### 18.1 Breakpoints
Tailwind defaults; the app keys almost everything on **`sm` = 640 px**: below = mobile layout (bottom tab bar, stacked rows, bottom sheets), at/above = desktop (top pill nav, table-like rows, dropdown menus). Occasional `lg:` for wider grids (`/draft` uses `max-w-[100rem]`). `globals.css` forces inputs to 16 px on <640 px to prevent iOS zoom.

### 18.2 Mobile-specific patterns (verified)
- Fixed **bottom tab bar** with safe-area padding; page bottom padding `pb-24` to clear it.
- **Safe areas:** `viewport-fit=cover`, `black-translucent` iOS status bar, header top padding `env(safe-area-inset-top)+0.75rem`, `.safe-px/.safe-pt/.safe-pb` utilities; `interactiveWidget: resizes-content` for keyboard.
- **Bottom sheets** instead of dropdowns on mobile: Account menu, League switcher, Edit Lineup, player detail in StarterComparisonTable.
- **Swipe:** matchup carousel (native horizontal scroll-snap), Cover-Flow owner card deck, draggable ticker, drawer swipe-to-close (Labs).
- **Pull-to-refresh** custom gesture on `(home)`, `(app)`, `(chat)`.
- **Chat:** single-pane (list ↔ thread) on mobile; two-pane on `sm+`; height computed from `100dvh` minus measured chrome (`--chat-top-offset`); paste-to-attach image.
- **Standings rows** stack vertically; Power Rankings/Trend tables horizontally scroll (Labs replaces the trend table with sparklines).
- **Drag-and-drop** (`@dnd-kit`, pointer + touch sensors): home card reorder (in "Edit Home" mode), bottom-nav reorder in Settings. Draft queue uses **up/down buttons**, not drag.
- **PWA install requirement:** iOS web push only works when installed to Home Screen (UI explains this).
- **Capacitor:** native shell loads the live site; native push via `@capacitor/push-notifications`; Discord OAuth uses `?client=native`.

### 18.3 Components that don't translate directly to a mobile-first rebuild (flag)

| Component | Issue |
|---|---|
| Power Rankings Trend table (non-Labs) | week-per-column table; needs sparkline/row layout on mobile (Labs version exists) |
| `DraftRoom` | wide multi-panel layout (pool + queue + board + chat); needs tabbed/segmented layout on phones |
| `DraftBoard` | grid of rounds × teams; paged by round |
| `LoungeVideoRoom`, `WatchPartyRoom` | LiveKit web components; screen share with system audio is desktop-browser-only |
| `LogoUploadCropper` | canvas cropping |
| `CardDeck` | scroll-driven 3D transforms (performance) |
| `AdminOverview` charts | custom SVG charts, desktop-oriented |
| `MessageComposer` paste-to-upload | clipboard image paste is desktop-centric |
| `.neon-panel` rotating glow ring | disabled app-wide for performance (§19) |

### 18.4 Desktop-only / mobile-only functionality
- Chat entry point: in the default nav, Chat is a header icon with unread badge on **all** widths (it is not a bottom tab); in Labs it becomes a primary tab/drawer item.
- Desktop-only: top pill navigation, dropdown (non-sheet) menus, two-pane chat, column headers on Standings, keyboard arrow navigation in menus.
- Mobile-only: bottom tab bar, pull-to-refresh, drawer (Labs), Stadium dock, bottom sheets, "‹ League" back link in League sub-nav.

---

## 19. Design System

### 19.1 Technology
Tailwind 4 utility classes inline in JSX + one global stylesheet (`frontend/src/app/globals.css`) holding tokens, a handful of named component classes, animations, and theme overrides. No component library (no shadcn/MUI). The `dark` class is permanently on `<html>`; **the app is dark-only** (the `dark:` variant is forced).

### 19.2 Color tokens (`:root`, default "Calm" theme)

| Token | Value | Use |
|---|---|---|
| `--wl-bg` / `--background` | `#0d1016` | page background |
| `--wl-surface` | `#12161c` | card fill |
| `--wl-border` | `#1c2027` | hairline borders |
| `--wl-accent` | `#39ff14` (neon green) | CTAs, active nav, "mine" |
| `--wl-accent-dim` | `#1f890b` | badges (unread count bg) |
| `--wl-text` / `--foreground` | `#eceef1` | primary text |
| `--wl-text-secondary` | `#8790a0` | secondary text |
| `--wl-live` | `#ef4444` | live/urgent only |
| `--wl-success` | `#22c55e` | positive |
| `--wl-warning` | `#facc15` | pending |
| `--user-accent` | owner's `accent_color` | overrides accent everywhere (`NAV_ACCENT = var(--user-accent, var(--wl-accent))`) |
| `--your-week-color` | owner pref | Your Week hero tint |
| `--border-glow-color` / `--ring-color` | owner pref | card ring |
| `--wl-glow-scale` | 1 (subtle 0.3, high 2.2) | decorative glow strength |

Theme overrides: `[data-wl-theme="cosmic"]` → bg `#0a0716`, surface `#171129`, border `#35285f`, accent `#39ffb0`, accent-dim `#1b8f6c` + starfield background (`public/images/cosmic-bg.webp`). `[data-wl-direction="broadcast"]` (red `#dc2626` accent, Bebas Neue/Source Sans 3/JetBrains Mono) and `[data-wl-direction="stadium"]` (cyan `#22d3ee` accent, live `#ff3864`, Space Grotesk/Space Mono).

Destination colors (used in Cosmic theme and discovery tiles; §8.2 plus): standings `#0ea5e9`, playerCards `#22d3ee`, freeAgents `#14b8a6`, chat `#39ff14`, awards `#facc15`, rivalries `#f97316`, rules `#84cc16`, chug `#d97706`, keepers `#10b981`, powerRankings `#3b82f6`, draft `#eab308`, awardsAllTime `#ca8a04`, history `#f59e0b`, trades `#d946ef`, activity `#64748b`.

Position colors (`lib/positionColors.ts`): QB `#f87171`, RB `#4ade80`, WR `#38bdf8`, TE `#fb923c`, K `#c084fc`, DEF `#facc15`, fallback `#9ca3af`.

Secondary text/borders are mostly written as Tailwind opacity utilities: `text-black/50 dark:text-white/50`, `border-black/10 dark:border-white/10`, `bg-black/[0.015] dark:bg-white/[0.03]`, dividers `divide-white/5`.

### 19.3 Typography
Body: IBM Plex Sans (`--font-body`, 400–700). Display: Oswald (`--font-display`, used uppercase + tracking for headings like team names). Mono: Geist Mono (tabular numbers). Scale in practice: page title `text-2xl font-semibold`; section header `text-xs font-semibold tracking-wide uppercase` in secondary color; body `text-sm`; meta `text-xs`; micro badges `text-[10px]`/`text-[11px]` uppercase bold; scores use `tabular-nums`. The proposed formal scale is in `Documentation/UX/01_Design_System.md`.

### 19.4 Shape, spacing, elevation
Cards `rounded-lg` (0.5 rem) or `rounded-xl` / `.wl-card` 0.875 rem; pills `rounded-full`; list rows `px-3 py-2`; card padding `p-3`/`p-4`; page vertical rhythm `gap-6`; list separators `divide-y`. Shadows are rare (`shadow-2xl` on menus/sheets, `shadow-sm` on award tiles); depth mostly from border + surface color.

### 19.5 Named component classes (`globals.css`)
| Class | Meaning |
|---|---|
| `.neon-panel` | standard card: surface bg + border; the rotating conic "ring" `::before` is **disabled app-wide** (`display:none`) for performance; Cosmic theme tints via `--panel-glow-cosmic` (`panelGlowStyle(color)`) |
| `.wl-card`, `.wl-card--live` (red left border), `.wl-card--featured` (keeps animated ring) | Labs flat cards |
| `.neon-navlink` (+ `[aria-current=page]`) | nav pill with `--nav-color` |
| `.live-dot`, `.live-dot--idle` | pulsing red dot |
| `.hero-live-glow` | pulsing red glow for live Your Week |
| `.countdown-tile` | draft/chug countdown tile with rotating border |
| `.score-pop` | score change animation |
| `.live-ticker-track`, `.ticker-shell` | marquee |
| `.rise-in` | entrance animation |
| `.home-ambient`, `.cosmic-ambient`, `.cosmic-bg`, `.cosmic-frame` | decorative backgrounds |
| `.flip-outer/.flip-inner/.flip-face` | 3D card flip |
| `.chat-bubble(--mine/--other/--mentions-me)`, `.chat-mention`, `.chat-typing-dot` | chat |
| `.gamecast-marker`, `.gamecast-flash`, `.gamecast-play-enter` | field/play animations |
| `.pull-to-refresh-*` | PTR indicator |
| `.weekend-*`, `.neon-sign*` | /weekend neon landing |
| `.glass-surface` | translucent surface |
| `.safe-px/.safe-pt/.safe-pb` | safe-area padding |

### 19.6 Motion & accessibility
Keyframes: panel-border-rotate, weekend-neon-buzz, neon-power-on/heartbeat/sparkle/wave/ripple, rise-in, pull-to-refresh-spin, hero-live-pulse, countdown-border-rotate, score-pop, live-dot-pulse, chat-typing-bounce, gamecast-flash, gamecast-play-enter. All disabled by `.motion-reduced` (owner pref `reduced_motion`) and `@media (prefers-reduced-motion: reduce)`. Menus use `role="menu"`, `aria-expanded`, keyboard arrows/Escape; nav uses `aria-current`; decorative elements `aria-hidden`.

### 19.7 Imagery & icons
Custom SVG icons (`components/nav/icons.tsx`); emoji used heavily as iconography (🏆 ⭐ ⚔️ 💀 🔥 🥶 📈 📉 🎯 😬 🍺 📢 🚽 💩 👑). Brand emblem `public/images/weekend-league-emblem.png`; PWA icons 192/512 (+maskable); owner photos `public/images/owners/*.jpg` (hard-coded for League #1 owners); player headshots `a.espncdn.com/i/headshots/nfl/players/full/{espnId}.png` and `sleepercdn.com/content/nfl/players/{sleeperId}.jpg`; team logos `a.espncdn.com/i/teamlogos/nfl/500/{abbr}.png`; owner team logos = Vercel Blob URLs. Audio: `public/audio/can-opening.m4a`, `intro-pour.m4a`, `light-switch.m4a` (intro).

### 19.8 Recurring UI patterns to standardize in Base44
Section header link ("LEAGUE STANDINGS" small caps linking to full page) · ranked list card (rank · name · badge · value) · score row (two teams, two right-aligned tabular scores) · pill tab rows · status pills (Active, Locked, AUTO, KEEPER, Champion) · `TeamRankBadge` (#N chip) · `MovementBadge` (▲N green / ▼N red / —) · bottom sheet · confirm dialog (native `window.confirm` today) · inline error text (red, `text-sm`) · copy-to-clipboard button with "Copied!" 2 s feedback.

---

## 20. Complex Interactions

Each: (1) user action → (2) UI → (3) API → (4) response → (5) afterwards.

### 20.1 Lineup edit (My Team)
1. Tap a player's slot pill (editable week only).
2. Bottom sheet "Edit Lineup" lists eligible destinations grouped Starters / Bench / Injured Reserve, each showing occupant or "Empty"; current slot disabled; locked occupants omitted; if the tapped player is locked, sheet shows the lock message only.
3. Empty slot → `POST /me/team/lineup/move {sleeper_player_id, to_slot}`; occupied slot → `POST /me/team/lineup/swap {sleeper_player_id_a, sleeper_player_id_b}`. No confirm step (preview endpoints exist but are unused).
4. `{roster}` (slim entries) or error `detail` (409 locked, 400 ineligible).
5. Merge new `lineup_slot` values into the existing rich roster; close sheet; show "Moved X to FLEX." / "Swapped A and B."; errors stay inline in the sheet.

### 20.2 Add free agent / waiver claim
1. Tap Add (or Claim) on a free-agent row.
2. Inline panel: confirm → "Adding…".
3. `POST /me/team/free-agents/add`.
4. 200 → success (row removed); 409 `roster_full` → panel loads `GET /me/team` and asks which player to drop → confirm drop → re-POST with `drop_sleeper_player_id`; 409 `on_waivers` → row marked on waivers, panel switches to claim menu → optional drop pick → `POST /me/team/waivers/claim`.
5. Claims appear in "My waiver claims" (cancel while pending → `POST …/cancel`); processed later by the scheduler (status successful/failed + `failure_reason`).

### 20.3 Drop player
Player card (only when `is_on_my_team`) → "↓ Drop" → `window.confirm("Drop X back to free agency? Anyone else can pick them up.")` → `POST /me/team/lineup/drop` → full page reload. Server starts a 1-day waiver clock.

### 20.4 Trade builder
Pick partner team (`GET /trades/teams`) → load both rosters (`GET /trades/teams/{id}/roster`) → toggle players in "You give" and "You receive" → "Propose trade" (enabled when both non-empty) → `POST /trades` → refresh list. Receiver: Accept/Reject (`POST /trades/{id}/accept|reject`); proposer: Cancel. With review required, accepted trades move to "Awaiting commissioner review"; commissioner approves/vetoes in Commish › Trades.

### 20.5 Draft queue & picks
Pool row "+" → `POST /draft/queue` (returns full queue); "−" → `DELETE /draft/queue/{id}`; ↑/↓ buttons → `PUT /draft/queue/reorder` with the full ordered list; Draft button (only on the clock) → `POST /draft/pick` → refetch state + pool; every client refetches on the `pick_made` broadcast. Queue feeds autopick when the clock expires.

### 20.6 Draft commissioner controls
Create draft (order = team owners in chosen order, roster slots, pick seconds) → `POST /draft/setup`; schedule → `PUT /draft/schedule`; reorder → click teams in new order → `PUT /draft/order`; Seed keepers → `POST /draft/seed-keepers` (400 lists unresolved keepers by name); Start/Pause/Resume/Undo → broadcasts `draft_status`/`pick_undone`; Reset → confirm dialog → `POST /draft/reset` → `draft_reset` broadcast.

### 20.7 Matchup carousel
Tap a matchup chip in the switcher or swipe the scroll-snap track → `activeIndex` updates both; no network. Tap a player in the comparison table → stat breakdown sheet from `raw_stats` (labels via `scoringLabels.ts`). Viewer's team always left.

### 20.8 Chat
Open conversation → load messages (`GET …/messages`) + `POST …/read`. Type → throttled `typing` WS frame. Send → WS `message` frame; the message appears when the server broadcast returns (no optimistic insert). Reply → reply chip → `reply_to_id`. @ → mention picker → inserts `@DisplayName` and adds owner id to `mentions`. Attach/paste image → Vercel Blob upload (`/api/chat/upload` token) → `image_url`. GIF → `GET /chat/gifs?search=` → selecting sends its GIPHY URL as `image_url`. React → `POST /chat/messages/{id}/react` (toggle) → WS `reaction`. Delete own → `DELETE /chat/messages/{id}` → WS `deleted`. Scroll to top → "load older" (`before`). New DM → member picker → `POST /chat/conversations/direct`. First-ever send → AI training notice modal → `PUT /settings/preferences`.

### 20.9 Chug upload
Choose video (commissioner may choose "Credit to") → `POST /auth/ticket?purpose=chug_upload` → `POST {API}/chug/upload?ticket=…[&owner_id=]` multipart `video` **directly to the backend** (not via proxy) → read the streamed body to the end, ignore leading whitespace heartbeats, parse the JSON after the last newline → show scores/roast or "Couldn't detect a clear chug…" / error message → refresh leaderboard/feed.

### 20.10 Home card reorder
"Edit Home" → drag handles (`@dnd-kit` sortable, vertical list) → drop → local order updates immediately → `PUT /settings/preferences {home_card_order: JSON.stringify(order)}` in background (errors swallowed).

### 20.11 League switch
Chip/sheet or `/leagues` → `POST /leagues/{id}/select` → re-fetch every league-scoped screen (current app: `router.refresh()`).

### 20.12 Push notification enable (web)
Settings › Notifications → toggle on → checks support (iOS must be installed PWA) → `Notification.requestPermission()` → `GET /push/vapid-public-key` → `pushManager.subscribe` → `POST /push/subscribe {endpoint, keys, device_label}` (on failure, local subscription is undone) → Send test → `POST /push/test`. Off → `POST /push/unsubscribe {endpoint}`.

### 20.13 Commissioner force-edit roster
Pick team (`/leagues/{id}/teams`) → `GET /leagues/{id}/teams/{team}/roster` → drop/move/swap/add (search FA) → add may return 409 `on_waivers` → confirm "override waivers" → re-POST with `override_waivers:true` (server force-clears the waiver).

### 20.14 Pull-to-refresh / live refresh
Pull down at scroll-top (not inside nested scrollers) past 70 px → release → refresh current route data. Game-day auto refresh every 45 s while visible.

### 20.15 Confirmation dialogs (current = `window.confirm`)
Drop player; draft reset; (others use inline two-step confirm panels: FA add/drop, claims). Base44 should use a consistent modal component.

---

## 21. External Integrations

### 21.1 Frontend-side dependencies (the browser talks to these directly)

| Service | Purpose | How |
|---|---|---|
| FastAPI backend | everything | HTTPS + WSS |
| LiveKit Cloud/Server | Watch Party & Lounge audio/video | `livekit-client` connects to the `url` returned with a short-lived token |
| Vercel Blob | chat images, feedback screenshots, owner logos | `@vercel/blob/client upload()` with token from a **Next.js route handler** (`/api/chat/upload`, `/api/settings/logo-upload`) using `BLOB_READ_WRITE_TOKEN` (implicit env) |
| S3-compatible bucket (chug videos) | playback | presigned GET URL from `GET /chug/{id}/video` |
| ESPN CDN (`a.espncdn.com`) | player headshots, team logos | `<img>` / `next/image` |
| Sleeper CDN (`sleepercdn.com`) | player headshots fallback | `<img>` |
| GIPHY CDN (`*.giphy.com`) | GIF display | URLs returned by backend search |
| Google Fonts | fonts | `next/font/google` (self-hosted at build) |
| Discord OAuth | login consent screen | browser redirect via backend |
| Web Push services / APNs / FCM | notification delivery | browser `PushManager`, Capacitor plugin |
| Capacitor native shell | app-store distribution | wraps `https://weekend-league-web.vercel.app` |

### 21.2 Backend-side dependencies (never call these from the frontend)

| Service | Purpose | Backend module | Credential |
|---|---|---|---|
| ESPN private league API (`espn_api`) | league/teams/matchups/rosters sync, ownership %, waiver settings, keeper prior rosters, player overview | `providers/espn/*`, `providers/sync.py` | `ESPN_S2`, `ESPN_SWID`, `ESPN_LEAGUE_ID`, per-league encrypted creds (`ESPN_CREDENTIAL_ENCRYPTION_KEY`) |
| ESPN public scoreboard/stats | NFL scoreboard, live game state, stat lines for scoring | `providers/nfl_scoreboard.py`, `providers/nfl_stats/espn_public.py`, `gamecast/providers/espn.py` | none |
| Sleeper | player identity/metadata | `providers/sleeper/*` | none |
| Sportradar | Gamecast play-by-play (optional) | `gamecast/providers/sportradar.py` | `SPORTRADAR_API_KEY` |
| Anthropic Claude | weekly recaps, draft narratives, chug roasts | `providers/anthropic_narrative.py`, `domain/narrative_engine.py`, `domain/chug_roast.py` | `ANTHROPIC_API_KEY` |
| GIPHY | GIF search proxy | `providers/giphy.py` | `GIPHY_API_KEY` |
| LiveKit | token minting | `routers/watch_party.py`, `routers/lounge.py` | `LIVEKIT_API_KEY/SECRET/URL` |
| S3-compatible storage | chug video storage | `providers/chug_storage.py` | `CHUG_BUCKET_*` |
| Chug CV analyzer | video grading (MediaPipe; separate Python 3.11 env) | `chug_analyzer/*`, `providers/chug_analyzer_bridge.py` | — |
| Web Push (VAPID) | push | `notifications/dispatcher.py` | `VAPID_*` |
| APNs / FCM | native push | `notifications/apns_client.py`, `fcm_client.py` | `APNS_*`, `FCM_SERVICE_ACCOUNT_JSON` |
| Resend | password reset email | `notifications/email.py` | `RESEND_*` |
| Discord / Google OAuth | identity | `auth/discord_oauth.py`, `auth/google_oauth.py` | `DISCORD_*`, `GOOGLE_*` |

### 21.3 Environment variables the frontend reads
`NEXT_PUBLIC_API_BASE_URL` (backend origin, used both SSR and for direct WS/upload/OAuth links), `NEXT_PUBLIC_SITE_URL` (metadata base), `COOKIE_SAMESITE` (frontend session cookie SameSite; `none` for cross-site iframe previews), `BASE44_PUBLIC_HOST_SUFFIX` (dev allowed origins), implicit `BLOB_READ_WRITE_TOKEN`. Base44 equivalent needs only: backend base URL (HTTP + WS), and an upload solution (§27 R2).

---

## 22. What Base44 SHOULD Build

1. **API client layer**: one module wrapping `fetch` with base URL + Bearer header + JSON parsing + `detail` error extraction (string, or object for `seed-keepers`/`admin delete`/FA 409s) + 401 handling (clear token → sign-in). Port the types from `frontend/src/lib/*.ts` verbatim.
2. **Auth UI + session store**: sign in/up, forgot/reset, Discord (native-style ticket flow), token persistence, `GET /auth/me` bootstrap, logout (call `POST /auth/logout` then clear), account deletion, co-owner and claim-owner token replacement.
3. **App shell & navigation**: header, bottom tab bar (5 destinations), account menu, league switcher, League and My Team sub-navs, season tabs, route guard (signed-out / no-league / commissioner / admin), 404 and error screens, offline banner.
4. **Screens** in §9 (default layout), including all empty/loading/error states in §17.
5. **Reusable components**: card, ranked list, score row, matchup score header, win probability bar, player row (headshot/injury/lock/projection), position badge, rank/movement badges, pills/tabs, bottom sheet, modal/confirm, toast/inline error, countdown tile, ticker, copy button, avatar/logo, emoji award tiles.
6. **Real-time clients**: one shared WebSocket helper (ticket mint → connect → typed event dispatch → 2 s reconnect, stop on 4401/4404) used for chat/presence, draft, Gamecast, Watch Party digest.
7. **Live refresh policy**: during live NFL games (derived from `/nfl/scoreboard`), refetch Home/matchup/ticker data every 45 s and My Team every 15 s while visible.
8. **Forms** with the server rules in §16 as inline hints.
9. **Design system** reproducing §19 tokens (dark-only, neon green accent, user accent override), typography, and emoji iconography.
10. **Responsive behavior** in §18 (mobile-first; `sm` breakpoint).
11. **Frontend-only interactions**: drag-reorder (home cards), swipe carousel, pull-to-refresh, bottom sheets, image paste/attach, GIF picker, mention picker, LiveKit room UI.
12. **Analytics**: fire `POST /admin/track` page views/feature events per `analyticsEvents.ts` (optional but keeps the admin dashboard meaningful).

---

## 23. What Base44 Must NOT Rebuild

All verified to exist server-side:

- **PostgreSQL schema & migrations** (`backend/migrations/`, 85 Alembic revisions, ~75 tables).
- **Authentication backend**: JWT issuance, bcrypt passwords, token revocation (`token_version`), rate limiting, Discord/Google OAuth, password reset email, ticket tokens, native OAuth redemption.
- **League authorization**: active-league resolution, membership/commissioner/site-admin checks (`backend/app/auth/league_context.py`).
- **Multi-league management**: create/join/invite codes, member roles, team creation/reassignment, historical owner claiming, co-owners.
- **Fantasy scoring engine** (`domain/scoring_engine.py`, `weekly_stats.py`), live projections, win probability, expected score, boom/bust, bench crimes, clutch/choke, streaks.
- **Roster & lineup engine** (`domain/lineup_engine.py`, `roster_slots.py`, `ir_rules.py`) including kickoff lock and IR rules.
- **Waivers** (`domain/waivers.py`): clocks, priority, claim processing.
- **Trades** (`domain/trades.py`): validation, deadline, review/veto.
- **Draft engine** (`domain/draft_engine.py`, `draft_autopick.py`), draft clock, auto-start, keeper seeding, draft grades & narratives.
- **Keepers** logic and auto-lock.
- **Standings, playoffs** (`domain/playoffs.py`), **power rankings** (`domain/power_rankings.py`, `weekly_team_stats.py`), **week flip** (`domain/week_flip.py`).
- **Awards & records** (`season_awards.py`, `weekly_awards.py`, `awards_all_time.py`, `records.py`), **rivalries**, **team/career profiles**, **league activity feed**, **league ticker**.
- **AI narrative engine** (weekly recaps, draft narratives, chug roasts) — server-side Anthropic calls.
- **Chat persistence & WebSocket servers** (chat, draft, Gamecast, Watch Party), presence, read receipts, reactions, mentions, push fan-out.
- **Gamecast data pipeline** (ESPN public / Sportradar / mock providers, cache, fantasy impact).
- **Chug system** (standing/doubling/fines, CV analyzer, video storage, roasts).
- **Notifications**: Web Push, APNs, FCM dispatch, preference/Sunday Mode/quiet-hours filtering, event producers.
- **Provider adapters & sync**: ESPN private/public, Sleeper, per-league ESPN connection with encrypted credentials, schedulers.
- **LiveKit token minting**, **Lounge** password/lockout logic, **GIPHY proxy**.
- **Admin analytics** aggregation and taxonomy validation.

Base44 should **not** call ESPN, Sleeper, Sportradar, Anthropic, GIPHY search, or LiveKit server APIs directly, and must never hold their credentials.

---

## 24. Recommended Base44 Build Order

Sequenced to front-load shared infrastructure and the highest-traffic screens, and to defer the most complex/rare ones.

| Phase | Scope | Why here | Depends on |
|---|---|---|---|
| **0. Backend readiness (outside Base44, small)** | add Base44 origin to `CORS_ALLOWED_ORIGINS`; add `PATCH` to CORS `allow_methods`; decide the upload approach (§27 R2); confirm `NATIVE_APP_UNIVERSAL_LINK_BASE`/`FRONTEND_URL` for OAuth return; confirm `fantasy-impact` Bearer gap acceptable | direct browser→API calls fail without these | — |
| **1. Foundation** | design tokens & base components (§19, §22.5), API client + types, auth store, sign in/up/forgot/reset, `/auth/me` bootstrap, route guard, app shell (header, bottom nav, account menu), 404/error, offline banner | everything else uses these | 0 |
| **2. League onboarding** | `/leagues` hub (create/join/switch/create team/claim/rename/roles), league switcher, NeedsLeague state, `/join-co-owner` | without an active league no data renders | 1 |
| **3. Core read screens** | Home (Your Week, standings, power rankings, other matchups, awards, activity, discover; tickers), League overview (+poll vote), Standings (3 tabs), Matchup carousel, Team detail, Power Rankings, Rivalries | highest traffic, read-only, reuse most components | 2 |
| **4. My Team & transactions** | My Team (roster, week paging, edit-lineup sheet, co-owner invite), Player card modal (incl. drop), Free Agents (+waivers), Trades | primary interactive loop in season | 3 |
| **5. Live layer** | shared WS helper; presence; game-day refresh policy; Gamecast hub + game (WS + fantasy impact) | adds real-time on top of built screens | 3–4 |
| **6. Chat** | conversations, threads, composer (mentions, replies, reactions, delete, GIFs, images), Commish's Corner announcements, unread badge | largest single real-time feature | 5 |
| **7. Draft & Keepers** | Draft room (pool, queue, picks, board, chat, clock), commissioner draft setup/controls, Keepers, season draft recap | seasonal; complex; needs WS helper | 5 |
| **8. History & fun** | History hub, Awards, All-Time Records, Owner profile, Player Cards deck, Chug (leaderboard/feed/upload/commissioner actions), Activity, Rules | lower frequency | 3 |
| **9. Settings** | Profile (logo upload), Notifications (push), Chat prefs, Appearance, Navigation (after C1 fix), Account, Feedback | depends on upload decision | 1 |
| **10. Commissioner tools** | hub + 8 sub-pages | small audience | 2, 7 |
| **11. Social video** | Watch Party (LiveKit) inside Chat, Lounge + public `/lounge/[slug]` | third-party SDK work | 6 |
| **12. Admin** | overview, navigation heatmap, users, leagues | site owner only | 1 |
| **13. Polish** | intro/boot animations, marketing pages (`/welcome`, `/commissioners`, `/weekend`), Labs variants (beta nav, Cosmic/Broadcast/Stadium), pull-to-refresh, motion, PWA/native push | optional | all |

---

## 25. Recommended Base44 Prompting Strategy

Goal: spend generation credits on building, not rediscovery.

1. **Upload this file once** as project knowledge / the first message, and in every later prompt refer to it by section numbers ("Implement §9.17 My Team using the endpoints in §11.4 and rules in §15.2").
2. **First prompt = foundation contract, no screens:**
   > "Read BASE44_UI_SPEC.md. Build only: (a) design tokens and base components from §19 and §22.5; (b) a typed API client from §11 using `Authorization: Bearer <token>` against `VITE_API_BASE_URL` (or equivalent), with the TypeScript types listed in §1/§11 copied exactly; (c) auth screens and session handling from §6 and §9.2; (d) the app shell and route guard from §8 and §6.5. Do not create any backend, database, mock data, or endpoints. Do not build any other screens yet."
3. **One area per prompt**, following §24. Template:
   > "Using BASE44_UI_SPEC.md, build §9.X <Screen>. Use only the endpoints listed for it in §11 and §12 — do not invent endpoints or fields. Reuse existing components (<list>). Implement the states in §17 for this screen and the responsive rules in §18. Do not modify <already-built areas>."
4. **Guardrails to repeat in every prompt** (short form):
   - "Backend already exists — never generate backend code, database entities, seed data, or mock APIs."
   - "If a field isn't in the spec's types, don't display it; if something is marked UNKNOWN, leave a TODO instead of guessing."
   - "Business rules (§15) are enforced by the server: show server `detail` messages; don't re-implement scoring, lineup legality, waivers, trades, or draft logic."
   - "Reuse the shared API client, WebSocket helper, and components; don't create parallel versions."
   - "Keep the design tokens in §19; dark theme only."
5. **Batch small, related screens** in one prompt to save credits (e.g., §9.7 Rivalries + §9.9 History + §9.10 Awards + §9.11 Records in one go; all 8 commissioner sub-pages in one or two prompts because they are simple forms).
6. **Build the WebSocket helper once** (Phase 5 prompt) with the exact close-code and ticket rules in §13.0, then reference it for chat/draft/gamecast/watch party.
7. **Verification prompt after each phase:** "List every endpoint this phase calls and confirm each exists in §11 with the same method, path, and body. Report any mismatch instead of fixing by inventing."
8. **Avoid regeneration churn:** explicitly name files/components that must not be rewritten ("do not change ApiClient, AuthStore, AppShell"). Ask for additive changes.
9. **Keep Labs/animations for the end** (§24 Phase 13); they are expensive and optional.

---

## 26. Feature Matrix

| Feature | Exists | Frontend | Backend | API | Real-Time | Mobile | Notes |
|---|---|---|---|---|---|---|---|
| Email/password auth | Yes | Yes | Yes | `/auth/login`, `/signup` | — | Yes | rate-limited |
| Discord OAuth | Yes | Yes | Yes | `/auth/discord/*` | — | Yes (native ticket flow) | members only |
| Google OAuth | Partial | Hidden | Yes | `/auth/google/*` | — | — | no credentials configured |
| Password reset | Yes | Yes | Yes | `/auth/forgot-password`, `/reset-password` | — | Yes | Resend email |
| Account deletion | Yes | Yes | Yes | `DELETE /auth/me` | — | Yes | guarded |
| Multi-league / switching | Yes | Yes | Yes | `/leagues/*` | — | Yes | session-scoped |
| Co-owners | Yes | Yes | Yes | co-owner invite/redeem | — | Yes | |
| Historical owner claim | Yes | Yes | Yes | claim-owner | — | Yes | |
| Home dashboard | Yes | Yes | Yes | many | 45 s refresh | Yes | reorderable cards |
| Standings / Scoreboard / Playoffs | Yes | Yes | Yes | league routes | refresh | Yes | bracket generation ops-only |
| Matchup detail | Yes | Yes | Yes | matchup-context | refresh | Yes (swipe) | |
| Power rankings | Yes | Yes | Yes | PR routes | — | Partial (trend table scrolls) | |
| Rivalries | Yes | Yes | Yes | `/rivalries` | — | Yes | |
| Awards / records | Yes | Yes | Yes | awards routes | — | Yes | |
| AI weekly recap | Yes | Yes | Yes | recap routes | — | Yes | needs Anthropic key |
| Owner profiles / cards | Yes | Yes | Yes | `/owners/*` | — | Yes | owner photos hard-coded |
| My Team / lineup | Yes | Yes | Yes | `/me/team*` | 15 s poll | Yes | kickoff lock |
| Free agents | Yes | Yes | Yes | `/me/team/free-agents*` | — | Yes | |
| Waivers | Yes | Yes | Yes | `/me/team/waivers*` | scheduler | Yes | no FAAB bidding UI |
| Trades | Yes | Yes | Yes | `/trades*` | — | Yes | no push notifications for trade events (none found in `notifications/`) |
| Keepers | Yes | Yes | Yes | `/keepers*` | — | Yes | pool read from ESPN |
| Live draft room | Yes | Yes | Yes | `/draft*` | WS | Partial (dense) | |
| Draft grades | Yes | Yes | Yes | draft-grades | — | Yes | |
| NFL player card | Yes | Yes | Yes | `/players/{id}/card` | — | Yes (modal) | |
| NFL player browser | Backend only | No | Yes | `GET /players` | — | — | `listPlayers` unused |
| Gamecast | Yes | Yes | Yes | `/nfl/*` | WS | Yes | signed-out gets no live updates |
| League chat / DMs | Yes | Yes | Yes | `/chat/*` | WS | Yes | |
| Commish's Corner | Yes | Yes | Yes | chat | WS | Yes | error frames unhandled |
| Presence | Yes | Yes | Yes | chat WS | WS | Yes | global broadcast |
| GIF picker | Yes | Yes | Yes | `/chat/gifs` | — | Yes | needs GIPHY key |
| Image attachments | Yes | Yes | Validation only | Next Blob route | — | Yes | frontend-hosted token route |
| Watch Party (video) | Yes | Yes | Yes | `/watch-party/*` | LiveKit + WS | Partial | needs LiveKit |
| Lounge (public video) | Yes | Yes | Yes | `/lounge/*` | LiveKit | Partial | guests allowed |
| Polls | Yes | Yes | Yes | `/leagues/{id}/polls*` | — | Yes | |
| League activity feed | Yes | Yes | Yes | `/seasons/{s}/activity` | — | Yes | |
| Chug | Yes | Yes | Yes | `/chug/*` | — | Yes | CV analyzer separate env |
| Web push | Yes | Yes | Yes | `/push/*` | push | iOS needs PWA install | |
| Native push | Yes | Capacitor only | Yes | `/push/native/*` | push | Yes | |
| Settings / preferences | Yes | Yes | Yes | `/settings/*` | — | Yes | nav order save broken (C1) |
| Themes / Labs | Yes | Yes | Prefs only | preferences | — | Yes | optional |
| Commissioner tools | Yes | Yes | Yes | various | — | Yes | |
| ESPN connection | Yes | Yes | Yes | `/league/espn-connection*` | — | Yes | |
| Schedule generation | Backend only | No | Yes | `/league/schedule/generate` | — | — | no UI |
| Playoff bracket generation | Backend only | No | Yes | `/admin/playoffs/*` | — | — | ops only |
| Admin dashboard | Yes | Yes | Yes | `/admin/*` | polling | Partial | site admin |
| Analytics tracking | Yes | Yes | Yes | `/admin/track` | — | Yes | |
| Feedback | Yes | Yes | Yes | `/feedback` | — | Yes | |
| Offline cache | Yes | SW | — | — | — | PWA | web-only |
| Rules page | Yes | Static | — | — | — | Yes | hard-coded League #1 |
| Marketing pages | Yes | Static | — | — | — | Yes | |

---

## 27. Known Gaps / Risks / Unknowns

### 27.1 Blockers for a direct-to-API frontend (resolve before/at Phase 0)

| ID | Issue | Evidence | Impact | Suggested resolution (needs human decision) |
|---|---|---|---|---|
| **R1** | CORS `allow_methods` omits `PATCH` | `backend/app/main.py` | Cross-origin `PATCH /leagues/{id}`, `/leagues/{id}/members/{uid}`, `/leagues/{id}/polls/{pid}`, `/admin/users/{id}/admin` fail preflight | add `PATCH` (small backend config change) or route through a same-origin proxy |
| **R2** | Image uploads rely on Next.js route handlers (`/api/chat/upload`, `/api/settings/logo-upload`) that mint Vercel Blob client tokens; **no backend equivalent** | `frontend/src/app/api/*` | Base44 cannot upload chat images, feedback screenshots, or logos | add a backend upload-token endpoint, keep a tiny serverless proxy, or defer the features; backend only accepts Vercel Blob (`CHAT_IMAGE_HOST`) or GIPHY URLs |
| **R3** | `CORS_ALLOWED_ORIGINS` must include the Base44 app origin; `allow_credentials=True` requires exact origins | `main.py` | all browser calls blocked otherwise | env change |
| R4 | OAuth return URLs are derived from `FRONTEND_URL` / `NATIVE_APP_UNIVERSAL_LINK_BASE` | `auth.py` | Discord login lands on the old frontend | point to the Base44 origin, implement `/auth/native-complete` (ticket redemption) there |
| R5 | `X-Frame-Options: DENY` on backend and frontend | `main.py`, `next.config.ts` | only matters if Base44 renders API responses in frames (unlikely) or embeds the old app | none unless needed |
| R6 | `GET /nfl/games/{id}/fantasy-impact` personalizes only via `session` **cookie** (`request.cookies`), not Bearer | `routers/gamecast.py` | Bearer clients get anonymous impact (game leaders only) | backend: use `get_session_token` |
| R7 | WebSockets accept cookie or `?ticket=` only | chat/draft/gamecast/watch_party routers | must mint tickets via `POST /auth/ticket` (Bearer OK) | follow §13.0 |

### 27.2 Confirmed bugs / discrepancies (do not silently "fix" in the frontend)

| ID | Issue | Evidence |
|---|---|---|
| **C1** | Bottom-nav order can never be saved: frontend sends 5 keys (`MOBILE_NAV_ORDER` = team, league, home, matchups, gamecast); backend requires exactly 6 (`_VALID_BOTTOM_NAV_KEYS` adds `chat`) → 400, swallowed by `.catch()` | `settings.py` vs `navDestinations.ts`, `NavigationSection.tsx` |
| C2 | `Me.owner_id` typed `number` in TS but backend returns `null` for league-less accounts | `auth.py` vs `api.ts`/`AccountMenu.tsx` |
| C3 | `/me/*` routes (week, team, lineup, FA add, waivers) read `payload["owner_id"]` from the **JWT claim** (can be stale) while most other routers use live `resolve_owner_id` A token minted before a team/owner link exists returns 404 "No team found" until the token is replaced (claim/redeem return new tokens; create-league/create-team do **not**) | `routers/me.py` (`_require_my_team`, `/me/week`) |
| C4 | Chat WS `error` frames (`commish_corner_restricted`, `commish_corner_title_required`) are never handled; messages sent while disconnected are silently dropped | `ChatApp.tsx` |
| C5 | `GamecastShell` comment promises REST polling fallback for signed-out users; not implemented | `GamecastShell.tsx` |
| C6 | `listWeekMatchups` helper calls a LeagueRead endpoint without auth (would 401); helper unused | `lib/api.ts` |
| C7 | Keepers signed-out state links straight to backend Discord login instead of `SignInCard` | `(app)/keepers/page.tsx` |
| C8 | `/feedback` GET returns feedback from **all leagues** to any league's commissioner | `feedback.py` |
| C9 | `/trades/teams/{team_id}/roster` does not verify the team belongs to the caller's league | `trades.py` |
| C10 | Presence events broadcast to **all** connected owners regardless of league | `chat/manager.py` `broadcast_to_all` |
| C11 | `/free-agents/waiver-settings` and `/keepers/me` call ESPN live; without ESPN credentials behavior is **UNKNOWN — requires verification** (likely 500), which would break the Free Agents / Keepers pages | `free_agents.py`, `keepers.py` |
| C12 | `DraftSetupPanel` exposes pick seconds, but the clock uses fixed 90 s / 60 s | `draft_engine.py` |
| C13 | Rules page is hard-coded to League #1's 2026 rulebook and is public; other leagues see it too | `(app)/rules/page.tsx` |
| C14 | Owner photos for Player Cards are static files for League #1 owners | `public/images/owners/` |
| C15 | Dead/unused code: `BottomNavBeta`, `ChugDueCard`, `MyTouchdownsSection`, `listPlayers`, `listWeekMatchups`, client-side `getAdminUserDetail/listAdminLeagues/getAdminLeagueDetail` | repo grep |

### 27.3 Backend capabilities with no UI (decide whether Base44 should add them)
`POST /league/schedule/generate`, `/admin/playoffs/generate|resolve`, `/admin/sync*`, `/admin/weekly-compute`, `/admin/waivers/process`, `/admin/weekly-team-stats`, `/admin/players/sync*`, `/admin/sync/bye-weeks`, `DELETE /admin/teams/{id}`, `/admin/lineup/*`, `/draft/keeper`, `/chug/standing/undo-week`, lineup preview endpoints, `DELETE /push/native/register/{device_id}`, `/game-day`, `GET /players`, Google OAuth. Per the task rules these are **not** to be treated as UI features unless the owner asks.

### 27.4 Unknowns requiring verification
- Production backend URL and hosting (Railway implied by comments/docs; no config in repo).
- Idle timeout / proxy behavior for long-lived WebSockets (no ping frames).
- ESPN-dependent endpoints' behavior with no ESPN credentials (C11).
- Exact `SCREEN_NAMES` and feature event taxonomy should be copied from `backend/app/analytics/taxonomy.py` if Base44 implements analytics.
- Which backend Base44 should target: `AGENTS.md` describes the local docker-compose stack, but day-to-day development may run against the hosted production database. Confirm before testing any mutation (drafts, trades, waivers, chat all write real league data).

### 27.5 Structural risks
- **In-process state** (presence, rate limits, WS rooms, Gamecast cache) → a multi-instance backend would break presence/broadcasts; frontend should treat presence as best-effort.
- **Heavy endpoints**: `matchup-context` returns every roster in the week; Home fires ~15 requests. Cache per week and refetch on the game-day interval rather than per navigation.
- **Schedulers off in dev**: live scoring, draft clock, waivers, keeper lock won't advance without `ENABLE_*` flags — test data may look frozen.
- **Four hand-rolled WS clients today**, no backoff/jitter; build one shared helper.
- **No CI and no frontend tests**; backend tests exist (108 files) but aren't automated.

---

## 28. Final Architecture Diagram

```
                     BASE44 FRONTEND  (web / mobile-first)
          screens · navigation · components · API client · WS helper
                 │                     │                      │
   HTTPS JSON    │  Bearer JWT         │ WSS ?ticket=          │ media / uploads
                 ▼                     ▼                      ▼
        ┌─────────────────────── EXISTING FASTAPI API ───────────────────┐     LiveKit SFU
        │ middleware: token_version revocation · CORS · security headers │◄─── (token from API)
        │                                                                │
        │  routers (26)          WS managers (in-process)                │     Vercel Blob
        │  auth · leagues ·      /chat/ws  (chat + presence)             │◄─── (URL validated
        │  league · me · draft · /draft/ws (draft room)                  │      by API; token
        │  trades · keepers ·    /nfl/gamecast/ws (game_state)           │      route = gap R2)
        │  chat · chug · nfl ·   /watch-party/ws (fantasy_digest)        │
        │  settings · push ·                                             │     S3 (chug video,
        │  polls · admin …                                               │◄─── presigned URLs)
        │        │                                                       │
        │        ▼                                                       │
        │  auth/league_context ── domain/ (scoring · lineup · waivers ·  │
        │  (session → active     trades · draft · keepers · playoffs ·   │
        │   league, roles)       power ranks · awards · chug · narrative)│
        │        │                        │                              │
        │        ▼                        ▼                              │
        │   queries/ (asyncpg raw SQL)   notifications/ (VAPID · APNs ·  │
        │                                 FCM · Resend)                  │
        │   scheduler.py (APScheduler, ENABLE_* flags): ESPN sync · live │
        │   sync · week flip · gamecast poll · draft clock · waivers …   │
        └────────┬──────────────────────────────┬────────────────────────┘
                 ▼                              ▼
            PostgreSQL 16              External providers (server-only)
        (~75 tables, Alembic)          ESPN private + public · Sleeper ·
                                       Sportradar · Anthropic · GIPHY ·
                                       Discord/Google OAuth · LiveKit keys
```
