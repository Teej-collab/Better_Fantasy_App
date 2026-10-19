# Open Work, Battery/Efficiency, and Systems Checklist — 2026-10-19

Three parts: (1) everything still open, verified against the code today;
(2) a battery/efficiency pass over every engine, ranked; (3) the
"who's gonna tell vibe coders" list (items 1–101; slides 6–7, items
102–111, weren't included) checked against this app.

`TODO.md` stopped being updated on 2026-09-25; 248 commits have landed
since. Several of its unchecked boxes are already done (see 1D).

---

## Part 1 — Open work

### 1A. Uncommitted work sitting in the tree
- `frontend/src/app/opengraph-image.tsx`, `twitter-image.tsx`, `robots.ts`, `sitemap.ts` + edits to `layout.tsx`, `welcome`, `commissioners`, `globals.css` — SEO/social-card pass, never committed.
- `backend/app/providers/kambi_slip.py` — Bally Bet (Kambi) shared-slip reader. Untracked; not wired to a route yet as far as git shows.
- `backend/app/scripts/delete_leagues.py` — one-off cleanup for the Oct "Sandbox ·" test leagues. Decide: commit it, or run it and delete it.
- `frontend/src/components/WeekendLanding.tsx` modified — that page is obsolete (per our notes); the edit is probably not worth keeping.
- `frontend/ios/**` (Capacitor wrapper) modified + new SPM folders — legacy; the real app is `mobile/`. **Retiring `frontend/ios` is still waiting on your OK.**
- `design-lab/`, `design-lab-glass/`, `design-exploration/`, `docs/BASE44_UI_SPEC.md`, `Documentation/Competitive_Audit/`, `Documentation/Marketing/` — untracked. Commit, gitignore, or delete.

### 1B. Release / ship
- **App Store**: readiness work shipped 10-06 → 10-09 (Sign in with Apple, report/block, real push, demo-account script). Confirm where review stands; `app.json` is at buildNumber 8 — bump before the next archive.
- **Android / Google Play**: build exists (10-01); deliberately parked until you say go.
- **Live Activities**: widgets + Live Activity shipped; server-driven `liveactivity` APNs pushes were the stated Week 4–5 goal — verify they update on a real device during a live slate.
- **AGENTS.md is stale** — still documents the Base44 docker setup we no longer use. Rewrite to match the real VS Code + Supabase + Railway + Vercel workflow.
- **PROJECT_STATE.md is stale** (Aug Phase 0 snapshot). Replace or delete.
- **Prod migrations**: Railway doesn't run alembic — any migration in this list needs a manual apply with your OK.
- **`ADMIN_SYNC_TOKEN`** was removed from code in Sept; still worth deleting from Railway env vars.

### 1C. Known bugs (confirmed in code today)
- **Gamecast (web) signed-out viewers stop updating** — `GamecastShell.tsx:64-69` says it falls back to REST polling; it just `return`s. Either add the poll or fix the comment.
- **Sunday Mode presets** — `game_day` vs `leave_me_alone` (`owner_preferences.py:145`) — re-check they're actually different now that real fantasy-activity pushes exist.
- **FG-by-distance scoring** — still not scored at all (ESPN box score lacks it; play-by-play is now parsed for Gamecast, so this is newly buildable). Per our rule, wait for a real occurrence before adding rare stats.
- **Muted-text contrast** — `text-black/40` now in 60 places (was 100), still 3.72:1 vs AA's 4.5:1. Design call, yours.
- **Link-destination audit** — never done; some in-app links pointed to the wrong place in Aug. Needs a click-through.

### 1D. TODO.md items that are actually done — close them
- Phase 4 "Auth: basic login" → Discord, Apple, Google, and passwords all exist.
- Phase 6 "Weekly recap page" → shipped (Weekly recap / Recap commits).
- App Store blockers (account deletion, privacy policy, native wrapper) → all three exist (`DELETE` account route, `(marketing)/privacy` + `terms`, Expo app).
- "5 owners have no Discord ID, can't log in" → moot now that Apple/Google/password login exists; verify those 5 have actually signed in.
- ESPN lineup-write "can the commish cookie write other teams" → moot after the ESPN-independence pivot (lineups are in-app).
- Phase 7.6 deferred homepage polish / "homepage not satisfying" → superseded by Living Home; close or restate.

### 1E. Product backlog still genuinely open
- Phase 10: Yahoo / Sleeper import adapters.
- Phase 11: productization (only if the platform proves out).
- Chug Analyzer on web (needs the separate 3.11/mediapipe service).
- Weekly compute refetches the same NFL box scores once per league (accepted trade-off; becomes real if leagues grow).

---

## Part 2 — Battery & efficiency audit

**Already in good shape** (don't touch): React Query pauses all polling when the app is backgrounded (`queries.ts:35`); chat WebSocket disconnects in the background; the honeycomb only animates on the focused tab; every NeonPanel shares one rotation; the web's Sept battery plan landed (GameDayRefresher visibility gate, SW cache cap at 60, single `--panel-border-angle`); backend caches the NFL scoreboard (15s) and box scores (10s live / 30m final); every live job is gated on `is_nfl_game_live`; Gamecast/Watch Party only poll games/rooms someone is watching; background widget refresh is push-driven, not a timer.

Ranked by expected battery saved, all with **zero feature loss**:

### P0 — Native: hidden tabs keep working (biggest idle drain)
Native tabs keep every visited tab mounted. What keeps running in tabs you aren't looking at:
- **Tickers** — `LiveTicker.tsx:73` `useFrameCallback` runs every frame (60–120 Hz) forever. `TickerStrips` renders two per tab; Home + Team + League mounted = up to **6 per-frame callbacks** while you're sitting in Chat. Fix: `useFrameCallback(cb, false)` + `setActive(isFocused)`.
- **Neon ring rotation** — `NeonPanel.tsx:29-35` starts once and **never stops**, even with zero panels on screen (Lounge, Chat, full-screen TV). A continuous animation also keeps ProMotion iPhones at 120 Hz. Fix: refcount *focused* panels; `cancelAnimation` at 0, resume at the same angle at >0. Also pause on `AppState !== 'active'`.
- **Live polling** — every live query (`my-week`, `matchup-context`, `my-team`, `matchup`, lounge lobby…) refetches every 15s during games **in every mounted tab and every screen under the current one in the stack**, not just the visible screen. Fix: React Query 5's `subscribed: useIsFocused()` in the live hooks (`queries.ts`) — the visible screen still polls at 15s; hidden ones catch up instantly on focus via `staleTime`.
- 1 Hz countdown/clock timers (`CountdownCard`, `LivingCards`, `keepers`, `draft`) re-render hidden tabs every second — same focus gate.

Verify with Xcode Instruments → Energy Log before/after on a live Sunday.

### P1 — Native: Lounge camera publish is heavier than the tiles need
`LeagueLoungeRoom.tsx:679` `setCameraEnabled(true)` uses LiveKit's default capture (720p30, simulcast). Phone cameras show as small hex tiles / a rail. Capturing at **540p or 360p @ 24fps** (`videoCaptureDefaults` on the room options) cuts encoder + radio cost substantially; adaptiveStream/dynacast are already on, which handles the receive side. Keep 720p for a tile that's enlarged, if one ever is.

### P2 — Backend: live scoring rewrites unchanged rows every 20s
`weekly_stats.py:61-71` upserts ~640 `player_week_stats` rows per league per tick, including every player whose game ended hours ago → ~115k row writes/hour/league during a Sunday slate (WAL, dead tuples, vacuum, Supabase I/O). Fix: add `WHERE (player_week_stats.raw_stats, player_week_stats.fantasy_points) IS DISTINCT FROM (EXCLUDED.raw_stats, EXCLUDED.fantasy_points)`. `computed_at` isn't read anywhere else, so nothing depends on it bumping. Same idea for `matchup_scoring.py:84` (skip the UPDATE when the score didn't move).

### P3 — Web: remaining un-gated intervals
These still tick in hidden browser tabs: bets (`BetsApp`, `SharedBetCard`, `GamecastBets`, `LeagueBetParts`), Lounge (`LoungeLobby`, `LoungeVideoRoom`, `LoungeNflSidebar`, `lib/loungeLive.ts`), `useWatchPartyLive`, admin (`AdminNav`, `AdminOverview`, `AdminHealthStrip`). Fix once with a shared `useVisibleInterval(fn, ms)` hook (the pattern `AdminLive.tsx` already uses). Also the plan's still-open P2-1: `GamecastShell` re-renders for every WS frame while hidden.

### P4 — Small / measure first
- Lounge timeline polls every 2s (`loungeLive.ts:18`). Deliberate (the server refreshes on demand, so poll rate = snapshot resolution), and while LiveKit is streaming the radio is up anyway — low marginal cost. If it ever matters, push snapshots over the LiveKit data channel instead.
- `connectivity.ts` 5s probe only runs while offline — fine.
- Draft clock / auto-start 2s jobs: one indexed query each — negligible.

---

## Part 3 — The systems checklist (1–101)

✅ = covered · ⚠️ = gap worth doing · — = not relevant at our scale (one backend instance, a handful of leagues)

| # | Item | Status |
|---|---|---|
| 1 | Rate limiting | ✅ auth, analytics, bets, admin (`auth/rate_limit.py`). ⚠️ Not on chat send / trade propose / waiver claim / photo upload — worth a per-user cap. |
| 2, 49, 50 | Caching / edge caching / invalidation | ✅ scoreboard + box-score TTL caches, phone-side persisted query cache, SW cache, Vercel CDN for static. |
| 3, 45–47 | Load balancing / scaling | — single Railway instance. **But see 21/33.** |
| 4, 5 | Reverse proxy / API gateway | ✅ Next `/api/backend/[...path]` proxy; Railway/Vercel edge. |
| 6 | CI/CD | ⚠️ No CI. 140 test files run only by hand. A GitHub Action running `pytest`, `tsc`, `eslint` on push is cheap insurance. |
| 7, 8, 9 | Docker / K8s / service discovery | — Railway + Vercel handle it. |
| 10 | Circuit breakers | ⚠️ Light. ESPN/Sleeper/Anthropic failures are caught per job, but nothing backs off a provider that's down — every tick retries. |
| 11 | Timeouts | ✅ httpx defaults to 5s everywhere it isn't set; APNs/FCM/ESPN set their own. |
| 12, 13 | Retries / backoff | ✅ push clients, ESPN lineup client, mobile React Query (`retry: 1`), WS reconnects. ⚠️ Web WS reconnect is a fixed delay, not exponential. |
| 14 | Idempotency | ✅ `*_notified_at` flags on every scheduled push, `ON CONFLICT` upserts everywhere, DB unique constraints on rosters/draft picks. |
| 15, 16, 17, 20 | Queues / pub-sub / events / DLQ | — APScheduler in-process; fine at this scale. Deferred-push job covers quiet hours. |
| 21, 33, 38 | Cron / leader election / distributed locks | ⚠️ **All schedulers and all WebSocket managers live in one process.** Safe only while Railway runs exactly **1 replica**. If it's ever scaled to 2, every job runs twice (double pushes, double waiver runs) and chat/draft sockets split. Guard: a Postgres advisory lock around scheduler start, and a note in Railway config. |
| 22–24 | WebSockets / long polling / SSE | ✅ chat, draft, Gamecast, Watch Party on WS; polling where WS isn't worth it. |
| 25, 26, 27 | Indexing / query optimization / N+1 | ✅ 51 indexes, batched `executemany`, `asyncio.gather` fan-outs. P3 of the Sept audit (legacy `get_rosters` N+1) still unprofiled. |
| 28 | Connection pooling | ✅ asyncpg pool 10–40, `statement_cache_size=0` for Supabase's pooler. |
| 29–32 | Read replicas / sharding / partitioning / replication | — |
| 34, 35 | CAP / eventual consistency | ✅ handled implicitly (Lounge delay buffer, cached reads). |
| 36, 37, 39, 40 | Locking / races / deadlocks | ✅ `FOR UPDATE` on draft, auction, trades, punishment wheel; unique constraints stop double-adding a free agent. ⚠️ Waiver processing has no row lock — fine on 1 replica, a race on 2. |
| 41, 42 | Memory leaks / GC | ✅ caches are TTL'd. ⚠️ `_GAME_STATS_CACHE` and Gamecast timelines are never pruned of old games — tiny, but grows all season until a deploy. |
| 43 | Thread safety | ✅ single asyncio loop. |
| 44 | Backpressure | — |
| 48 | CDN | ✅ Vercel + Blob for images. |
| 51 | Feature flags | ✅ env `ENABLE_*`, Labs/beta layout, per-league toggles. |
| 52–55 | Blue-green / canary / rolling / rollbacks | ⚠️ Railway deploys cause ~15–20s of 502s (volume). Rollback exists via Railway; OTA rollback via EAS. Avoiding deploys during games is the current mitigation. |
| 56, 57 | Health checks / probes | ✅ `/health`. ⚠️ Confirm Railway's healthcheck path is set to it so a bad deploy doesn't take traffic. |
| 58–62, 66 | Monitoring / logging / tracing / metrics / alerts | ✅ `monitoring.py` error/security capture, scheduler status, Admin health/alerts, crash tracking (Admin > Crashes). ⚠️ No external alerting — nothing pages you if prod is down at 1 PM Sunday. |
| 63–65 | SLOs / SLIs / error budgets | — |
| 67 | Secrets management | ✅ env-only, lazy-loaded. |
| 68, 69 | IAM / OAuth | ✅ Discord, Google, Apple; commissioner / site-admin roles. |
| 70 | JWT rotation | ✅ sessions expire after 30 days; WS/redeem tickets are short-lived and single-purpose. ⚠️ No way to rotate the signing secret without logging everyone out. |
| 71, 73 | TLS / in transit | ✅ Railway/Vercel/Supabase. |
| 72 | Encryption at rest | ✅ ESPN creds Fernet-encrypted; Supabase disk encryption. |
| 74, 75 | WAF / DDoS | ✅ Vercel firewall in front of the web app. ⚠️ The Railway backend URL is public; the native app calls it directly. |
| 76 | CORS | ✅ explicit origin list. |
| 77 | CSRF | ✅ SameSite=Lax session cookie; native uses Bearer tokens. |
| 78 | SQL injection | ✅ all parameterized; the few f-string queries interpolate constants/identifiers from hard-coded lists only. |
| 79 | XSS | ✅ 3 `dangerouslySetInnerHTML`, all app-generated (theme script, QR SVG). |
| 80 | SSRF | ✅ the server never fetches user URLs; shared-bet pages are fetched on the phone, Kambi/Giphy hit fixed hosts. |
| 81, 82 | Migrations / schema versioning | ✅ Alembic. ⚠️ Not run on deploy (manual, by design). |
| 83–85 | DR / backups / failover | ⚠️ Relying on Supabase's daily backups — confirm your plan's retention/PITR, and test one restore. |
| 86, 87 | Multi-region / chaos | — |
| 88 | Cost optimization | ✅ live jobs gated to game time; see Part 2 P2. |
| 89, 90 | Cold starts / serverless limits | ✅ Vercel functions are thin proxies; backend is long-running. |
| 91–94 | Latency / throughput / p99 | ⚠️ Not measured. `monitoring.py` records errors and security events, not response times; Railway's metrics are the only view today. |
| 95 | Network partitions | ✅ offline banner + cached data on the phone. |
| 96 | Clock skew | ✅ Lounge syncs to `server_now`; draft clock is server-authoritative. |
| 97–100 | DNS / TCP-UDP / HTTP2-3 / gRPC | — platform-handled (LiveKit uses UDP for media). |
| 101 | Webhooks | — none inbound today. |

### The short list of gaps from Part 3 worth doing
1. **Single-replica guard** (21/33/38) — advisory lock around the scheduler; document "replicas = 1".
2. **CI** (6) — run the existing tests automatically.
3. **External uptime alert** (62) — a free pinger on `/health` that texts you.
4. **Backup restore test** (84).
5. **Per-user rate limits** on chat/trades/claims/uploads (1).
6. **Provider back-off** when ESPN/Sleeper is down (10).
7. **Latency tracking** (91–94) — log request duration in the existing middleware.
