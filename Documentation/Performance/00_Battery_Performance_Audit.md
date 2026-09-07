# THE WEEKEND — Battery & Performance Forensic Audit

**Date:** 2026-09-07
**Scope:** Full-stack (Next.js 16 frontend on Vercel, FastAPI backend on Railway, Supabase Postgres, service worker/PWA, Web Push)
**Method:** Direct source audit of every timer, subscription, network call, and animation in the codebase, cross-referenced against real interval values, gating conditions, and cleanup logic. This is a **code-verified** audit, not a live-device profile — no Chrome DevTools/Lighthouse/React Profiler session was available in this environment. Every finding below cites the exact file/line and the exact interval or condition; **Section 19's numeric targets are estimates to validate on a real device**, not measured values. That validation is the first item in the companion optimization plan.

---

## 0. Executive summary

THE WEEKEND is **not** a battery disaster by design — it's better architected than most apps its size in the areas that matter most (realtime push, service worker, push notifications, entry animation). The real problems are narrower and more fixable than "the whole app is inefficient":

1. **Two client-side polling loops run unconditionally on tab/screen visibility during any live NFL game** — one refetches the *entire current page* every 45s, one refetches a full roster every 15s. Neither checks `document.visibilityState`. A user who opens the app during the Sunday slate and locks their phone (very common — "leave it open, check back later") keeps both loops running for however many hours of football remain.
2. **Every `.neon-panel` element (the app's dominant card style, used dozens of times per page) runs an infinite 5-second CSS animation** — a conic-gradient rotation composited through a mask — for as long as it's on screen, with no pause when off-screen and no accommodation for "many panels on one page" (the just-shipped matchup redesign alone puts 4-5 on one screen).
3. Backend realtime (Gamecast) is already close to ideal: **it only polls ESPN when a real game is live *and* at least one WebSocket client is actually watching that specific game**, then pushes to subscribers — no client ever polls Gamecast directly. This is the model the client-side polling in #1 should be rebuilt to match.
4. Service worker, push notifications, and the login/entry animation are all already well-built: event-driven, properly scoped, properly cleaned up, and the existing reduced-motion setting is honored correctly (both the OS-level media query and the app's own Settings toggle, in every place checked). These are not areas to "fix" — they're the pattern to extend to the two problem areas above.

Nothing here requires ripping out realtime functionality or slowing the app down to look better on a scorecard. The fix is **visibility-awareness** in the two places that don't have it yet, plus a cheaper (or paused-when-many-instances) glow animation.

---

## 1. Frontend rendering

**Component tree size:** Pages are modestly sized server components with a handful of client "islands" (MyTeamApp, ChatApp, DraftRoom, GamecastShell, FreeAgentsList, the matchup screen's StarterComparisonTable). This is the right shape — most of the app is server-rendered once per navigation, not client-rendered and re-rendered.

**Re-render sources found, by component:**

| Component | Re-render trigger | Frequency | Gated on visibility? |
|---|---|---|---|
| `GameDayRefresher.tsx` | `router.refresh()` (full server-component re-fetch of the current page) | every 45s, only while `isGameDay` | **No** |
| `MyTeamApp.tsx` (`RosterRow`) | `getMyTeam()` poll → `setTeam` | every 15s (`LIVE_POLL_INTERVAL_MS`), only while `isGameDay` | **No** |
| `GamecastShell.tsx` (`GameHeader`) | local `setInterval` recomputing "updated Ns ago" | every 1s, only while the game is live/scheduled | **No** (cheap: pure `Date.now()` math, no network) |
| `DraftRoom.tsx` / `KeepersPanel.tsx` / `ChugCountdownCard.tsx` / `DraftCountdownCard.tsx` | local countdown clocks | every 1s | **No**, but all are pure local `Date.now()` math — no network per tick, negligible cost |
| `AdminOverview.tsx` | 2 separate `setInterval`s covering 6 endpoints total | every 20s / 60s | **No** — but admin-only, single viewer (the commissioner), not a general-user concern |

**No missing-memoization or cascading-render problems found.** State is co-located sensibly (`useState` in the owning component, not lifted further than needed); the one app-wide context (`PresenceProvider`) is deliberately "dumb" (a `Map<ownerId, boolean>`) specifically so it doesn't force wide re-renders — see its own module comment.

**Missing virtualization:** No list in the app uses `react-window`/`react-virtual`. This is **not currently a real problem** — every list in this app is bounded by real league size (12 teams, a few hundred players in the free-agent pool, a chat history for ~12 people). Flag as a **watch item**, not a fix: if the free-agent pool grows (e.g., an "all NFL players" view) or chat history is ever rendered unpaginated for a very active league, virtualize then.

---

## 2 & 3. Network forensics + polling audit (combined — every polling site found)

| Location | Purpose | Frequency | Runs in background (tab hidden / app backgrounded)? | Necessary? | Recommended solution |
|---|---|---|---|---|---|
| `GameDayRefresher.tsx:26` | Full-page server refetch (scores, ticker, win probability) | 45s, gated on real live NFL game | **Yes — unconditionally** | Yes, but only while visible | Add `document.visibilityState` gate; pause interval when hidden, refresh once immediately on `visibilitychange` back to visible |
| `MyTeamApp.tsx:239` | Re-fetch own roster (on_offense/red-zone flags) | 15s, gated on real live NFL game | **Yes — unconditionally** | Yes, but only while visible | Same visibility gate; alternatively fold into a WS push (see §26) |
| `GamecastShell.tsx` | N/A — this is WebSocket push, not polling | event-driven | Connection stays open (WS exempt from Railway's idle timeout), but the app does no polling itself | Yes | No change needed — this is the reference pattern |
| `AdminOverview.tsx:87,92` | Admin dashboard live numbers (online owners, overview, timeseries, activity, alerts, system health — 6 endpoints total) | 20s / 60s, unconditional | Yes | Low-priority (admin-only) | Visibility gate; low priority given single-viewer scale |
| Backend: `_run_live_sync_job` (`app/scheduler.py:476`) | ESPN live fantasy-score sync | 60s, **only during a real NFL game window** (server-side gate, `is_nfl_game_live`) | N/A — server-side, always "background" by nature, but self-limiting to real game windows | Yes | Already well-gated; no change |
| Backend: `_run_gamecast_poll_job` (`app/scheduler.py:169`) | ESPN live play-by-play → WS broadcast | 4s, gated on **both** a real live game window **and** `gamecast_manager.live_game_ids()` (at least one WS client actually watching that specific game) | N/A — server-side | Yes | **This is the model** — see §26 |
| `AppTickerBar.tsx` / homepage | NFL scoreboard + league ticker | Once per page load/navigation (no client poll) — freshness comes from `GameDayRefresher`'s `router.refresh()` | N/A | Yes | No change — correctly server-rendered, not polled directly |
| No component was found polling the same resource from more than one place simultaneously. | | | | | |

**No case of "five components independently polling the same resource every 5 seconds"** was found — the closest thing (multiple WS connections while chat is open, see §4) is intentional and lightweight, not redundant polling.

---

## 4. Realtime audit

Every realtime channel in the app, and its lifecycle:

| Channel | Mounted | Reconnect | Cleanup on unmount | Notes |
|---|---|---|---|---|
| `PresenceProvider` (chat presence) | App-wide, `app/layout.tsx` — **one connection for the whole session** | 2s delay, skips code `4401` (auth failure) | Yes (`cancelled` flag, `socket.close()`, timeouts cleared) | **Reports `document.visibilityState` to the backend** on open and on every `visibilitychange` — this is exactly the pattern §5/§26 wants everywhere. Server-side `has_visible_connection` (`app/chat/manager.py`) uses this to decide whether to also push a notification. |
| `ChatApp.tsx` own socket (messages/typing) | Only while `/chat` is mounted | 2s delay, same auth-code skip | Yes | A **second** connection alongside PresenceProvider's while on `/chat` — see below |
| `DraftRoom.tsx` | Only while a draft room is mounted | 2s delay | Yes | Scoped correctly; a finished/not-yet-started draft never opens one unnecessarily (checked in-component) |
| `GamecastShell.tsx` | Only while a live/scheduled game's page is mounted | 2s delay | Yes | Never opens for a finished game (`status "final"/"postponed"/"canceled"` short-circuits before connecting) |

**Duplicate subscriptions:** While `/chat` is open, a user has **two** WebSocket connections open at once — the app-wide presence socket and chat's own message socket. This is a deliberate, documented split (presence needs to work app-wide without loading full chat state), and both are lightweight (presence sends nothing but `{type:"presence"}` frames; the connections themselves are exempt from Railway's HTTP timeout). **Not a real problem**, but worth centralizing in a future refactor if a third realtime feature is ever added to the same page.

**Do subscriptions survive navigation incorrectly?** No — every socket above is opened and closed inside a `useEffect` scoped to the owning component, with a `cancelled` flag guarding against a late reconnect firing after unmount. This is correct.

**How many realtime connections can one user have at once?** Up to 3: Presence (always), Chat's own socket (only on `/chat`), Gamecast's socket (only on a live game page), Draft's socket (only in a live draft room). These are mutually exclusive by page except Presence, which is always-on by design. This is reasonable and nowhere near excessive.

---

## 5. Page visibility

**Where it's used correctly today:** `PresenceProvider.tsx` — reports real `visibilitychange` state to the backend so the server can tell "app open in background" from "actually being looked at," specifically so background pushes aren't suppressed just because a stale WS connection is technically open. This is the *only* place in the app that currently reads `document.visibilityState` at all.

**Where it's missing:** `GameDayRefresher.tsx` and `MyTeamApp.tsx`'s live-poll effect (§2/§3) — both keep firing on their interval with the tab hidden or the PWA backgrounded. Neither the Page Visibility API nor any Page Lifecycle API (`freeze`/`resume`) is used to pause them.

**What actually happens today:**
- **User actively viewing:** everything works as designed.
- **User switches tabs / locks phone / backgrounds the PWA during a live game:** the two polling loops above keep running at full cadence for as long as the tab/PWA process stays alive (mobile Safari/Chrome typically suspend a backgrounded tab's JS after some vendor-specific delay, but that delay is not something this app controls or can rely on — see §6).
- **User returns:** no explicit "refresh stale data on return" logic exists beyond whatever the next natural poll tick or navigation triggers.

---

## 6. Mobile battery behavior

**CPU-intensive JS:** No hot loops, no unthrottled `requestAnimationFrame` usage anywhere in the codebase (confirmed by grep — zero `requestAnimationFrame` call sites). All animation is CSS-driven, which is the right default for battery (browser/GPU compositor handles it, not the JS main thread).

**The login/loading animation (`useWeekendIntro.ts` + `useIntroSound.ts`):** Already well-built — this was previously audited (2026-09-01, cited in the code's own comments: "8.45s to real content on Home, every visit" was the finding, already fixed). Today:
- The full word-by-word sequence is **bounded** (~4-5 seconds) and **runs once per session** (gated by a `wl_intro_seen` localStorage flag for repeat signed-out visits; `fast`/`skip` short-circuits for a returning authenticated user).
- **Reduced motion is checked correctly and completely** — both `prefers-reduced-motion: reduce` (OS-level, unconditional) and the app's own Settings > Appearance > Animations toggle (mirrored into a `wl_motion` cookie), and when either is set, it skips not just the visuals but the **sound processing too** (`playLightSwitch`/`playCanThenPour` are never called).
- Every timer is tracked in a ref array and cleared on unmount — no leaked timeouts.
- **This does not need further optimization.** It's already short-lived, cleanly terminated, not duplicated, and doesn't run after navigation.

**Where reduced motion is/isn't respected — audited exhaustively:**
| Animation | Respects `prefers-reduced-motion`? | Respects the app's own Settings toggle (`.motion-reduced`)? |
|---|---|---|
| Entry sequence (`useWeekendIntro.ts`) | Yes | Yes |
| `.neon-panel::before` glow rotation | Yes (media query) | Yes (`.motion-reduced` class) |
| `.live-dot`, `.gamecast-flash`, `.gamecast-play-enter` | Yes | Yes (same reduced-motion block, `globals.css:1100`) |
| `hero-live-pulse` (live-game hero glow) | Not separately checked, but shares the same block | Same |

The infrastructure is consistently wired. The issue in §17 below is that the **default** (non-reduced-motion) experience runs an unbounded animation, not that the setting fails to work.

---

## 7. Gamecast

Already close to the ideal architecture described in §26:

- **Server-side gating is two layers deep**: `is_nfl_game_live(games)` (a real game is happening at all) **and** `gamecast_manager.live_game_ids()` (at least one WebSocket client is actually subscribed to *that specific game*) — `app/scheduler.py:169-176`. If nobody is watching, zero ESPN calls happen, even during a live game.
- **Client never polls** — `GamecastShell.tsx` opens one WebSocket per game page and receives `game_state` pushes; the only client-side timer is the 1s "updated Ns ago" label, pure local math.
- **Update cadence (4s, `GAMECAST_POLL_INTERVAL_SECONDS`)** is reasonable for "how fast does a real football play actually resolve" — no case for faster, and 4s is already conservative against ESPN's undocumented private API (rate-limit risk noted in the code's own comments elsewhere).
- **What happens when nobody's viewing:** the poll job returns immediately (`return  # nobody's actually watching a Gamecast right now`) — zero backend work, zero ESPN calls.
- **What happens when the user backgrounds the app while watching:** the WebSocket connection itself doesn't get killed (WebSockets are exempt from Railway's request-timeout), so the server keeps pushing frames to a client that isn't looking. This is minor (frames are small, pushed only on real state changes) but is the one visibility gap in an otherwise well-designed feature — see the optimization plan for a cheap client-side fix (stop processing/re-rendering incoming frames while hidden, without closing the socket).

**Recommendation validated:** event-driven first (already true), intelligent polling second (already true, and already gated on real viewers), continuous polling last (never used). No architecture change needed here — only the visibility nuance above.

---

## 8. Chat

- **Messages arrive via WebSocket push** (`ChatApp.tsx`), not polling.
- **Presence** is a separate, deliberately minimal WS connection (§4) — a boolean map, no per-message chatter.
- **Typing indicators:** implemented as WS frames (not REST calls, not polled) with client-side debounce timeouts (`typingTimeouts` ref) so a burst of keystrokes doesn't spam a frame per character. This already satisfies "typing indicators should not create unnecessary network traffic."
- **Unread counts:** derived from already-fetched conversation state (`unread_count` field), updated locally on read rather than re-fetched.
- **No scroll-listener or resize-observer performance issues found** — `ChatApp.tsx` has one `resize` listener for keyboard-aware layout (cleaned up on unmount) and no continuous scroll polling.

Chat does not do continuous expensive work while idle. No changes recommended.

---

## 9. Live score / fantasy data — the real categories, and how each is currently updated

| Category | Example | Current update strategy | Correct? |
|---|---|---|---|
| Static | Player bio, team names | Server-rendered per navigation, browser HTTP cache | Yes |
| Slow-changing | Roster, standings, season totals | Server-rendered per navigation; `router.refresh()` every 45s **only during a live game** | Mostly — the 45s refresh should be visibility-gated (§2/§3), otherwise correct |
| Live | In-progress NFL game (Gamecast) | WebSocket push, server-gated on real viewers | Yes — already the ideal pattern |
| Live | Fantasy score during a game (My Team's on_offense/red-zone) | Client poll every 15s during game day | Works, but should be WS-pushed like Gamecast rather than polled (see §26) |
| Event | Chat message, typing, presence | WebSocket push | Yes |

Not every category is refreshed at the same frequency today — that discipline already exists. The one real inconsistency is that "live fantasy score" uses client polling instead of the same push model already built and working for Gamecast.

---

## 10. Database performance

This session's own work already found and fixed one real, measured N+1: `app/domain/matchup_context.py`'s own module comments document a **2026-09-02 finding — "this one endpoint took 3.36s for a 6-matchup week, almost entirely spent on ~40 small sequential round-trips to the same handful of tables"** — since fixed by batching `get_teams`/`get_current_rosters`/etc. This is direct evidence the backend has already been profiled for this class of problem at least once, and fixed when found. No unmeasured N+1 pattern was found in this pass across the query layer touched this session (`app/queries/league.py`) — every list endpoint that iterates matchups/teams already uses a batched query, not a per-item loop with its own query.

**Not independently re-verified in this pass:** the older, ESPN-legacy code paths (`get_roster`/`get_rosters`, still used by `/teams/{id}/roster` and a couple of admin routes) were not re-audited for the same N+1 shape — flagged as a watch item, not a proven problem, since they're low-traffic historical-data reads.

---

## 11. Caching

| Layer | What's cached | Risk |
|---|---|---|
| Service worker (`public/sw.js`) | GET responses through `/api/backend/*`, network-first with cache fallback | **Unbounded growth** — every distinct URL (including query-string variants, e.g. one entry per player card) is cached forever until a full version bump (`API_CACHE` name change) wipes everything. No per-entry expiry or LRU eviction. Low real-world impact at this league's scale, but worth a cap. |
| Next.js server fetch memoization | Per-request dedupe (e.g. `listSeasons()`/`getCurrentWeek()` called from both `AppTickerBar` and the page) | Correct, in-the-box behavior — no issue |
| Browser HTTP cache | Static assets, images | Standard, no issue |

**Authorization safety:** the service worker cache is keyed by full request URL through the authenticated `/api/backend/*` proxy, which itself forwards the visitor's own session cookie — a cached response was fetched *as that visitor*, so there's no cross-user leak risk from the cache itself. Not independently verified: whether the cache is ever shared across a signed-out→signed-in transition on the same device (e.g., a stale cached response for a previous session surfacing after a different account signs in on the same browser). Flagged for the optimization plan.

---

## 12 & 13. Service worker / PWA + push notifications

Both are **well-built and not a source of battery drain**:

- `sw.js` does exactly three things: cache one specific GET path prefix (network-first), handle `push` events (event-driven, from a real server push — never polls to check for notifications), and handle `notificationclick` (focus/navigate an existing tab). No background sync, no periodic sync, no unnecessary wakeups.
- `skipWaiting()`/`clients.claim()` on install/activate means a new deploy takes over immediately rather than leaving stale service workers running in old tabs indefinitely.
- Push subscription (`lib/push.ts`) is **entirely user-initiated** — never auto-subscribes on page load, requires an explicit permission prompt the user triggers from Settings, and rolls back the subscription if the backend registration fails (never leaves the browser subscribed to something the server doesn't know about).
- iOS-specific handling (`isIosDevice`/`isInstalledStandalone`) correctly tells the user up front that push requires installing to the Home Screen, rather than silently failing.

No changes recommended in this area.

---

## 14. Memory leak investigation

Checked every `useEffect` that creates a timer, listener, or connection for a matching cleanup function:

- **Timers:** every `setInterval`/multi-step `setTimeout` chain found has a corresponding `clearInterval`/`clearTimeout` in its effect's cleanup (verified for `GameDayRefresher`, `MyTeamApp`, `GamecastShell`, `DraftRoom`, `KeepersPanel`, `ChugCountdownCard`, `DraftCountdownCard`, `useWeekendIntro`).
- **WebSockets:** every socket (`PresenceProvider`, `ChatApp`, `DraftRoom`, `GamecastShell`) is closed in its effect's cleanup, guarded by a `cancelled` flag so a reconnect scheduled just before unmount doesn't fire into a dead component.
- **Event listeners:** the one `resize` listener (`ChatApp.tsx`) and the `visibilitychange` listener (`PresenceProvider.tsx`) are both removed in cleanup.
- **Unbounded growth candidates:** the service worker's `API_CACHE` (§11) is the one real unbounded structure found. Chat message state and Gamecast event state are both scoped to the current conversation/game and cleared on navigation — no evidence of indefinite accumulation in memory.

No leaked timers, listeners, or connections were found in this pass.

---

## 15. Navigation

Every timer/subscription audited above is scoped inside the owning client component's `useEffect`, which React tears down on unmount when a navigation removes that component from the tree — there is no module-level (outside-a-component) timer or subscription anywhere in the codebase that could survive a navigation by construction. `GameDayRefresher`'s interval is the longest-lived by design (meant to keep firing for the whole page lifetime, not per-navigation), and even that is unmounted the moment the visitor navigates to a page that doesn't render `AppTickerBar`.

---

## 16. Login / loading experience

Covered in depth in §6 — already matches the desired spec (full animation → "Welcome Back, [Name]" → Home for an authenticated repeat visit unless reduced motion is set; abbreviated/instant for reduced motion) and does not need a redesign, only continued care not to regress it.

---

## 17. CSS performance — the one clear P1 finding

**`.neon-panel::before` (`globals.css:221-248`)** is the app's dominant "card" decoration — a rotating conic-gradient ring, masked to just the border, driven by `@property --panel-border-angle` for smooth interpolation, running as `animation: panel-border-rotate 5s linear infinite`. It is used on essentially every panel throughout the app (standings, matchup cards, the newly-redesigned matchup screen's several sections, chug upload, free agents, admin — dozens of call sites).

This is a real, provable, continuously-running GPU/compositor cost:
- It runs **for as long as the element is visible**, with no pause, no `content-visibility` scoping, and no reduction when many instances are on screen at once (a page like the redesigned matchup screen renders 4-5 `.neon-panel` instances simultaneously, each independently animating).
- It **is** correctly disabled under both `prefers-reduced-motion` and the app's own reduced-motion setting — so the fix here is about the *default* experience, not a broken setting.

Other CSS effects (backdrop-filter, box-shadow pulses) are minor by comparison — only 2 `backdrop-filter` uses in the entire stylesheet, and the pulse/flash animations (`.live-dot`, `.gamecast-flash`, `hero-live-pulse`) are already gated to genuinely live states and already respect reduced motion.

---

## 18. Image/media performance

- Icons and static images are reasonably sized (`icon-192`, `icon-512`, maskable variants for PWA install — correct set, nothing oversized found).
- No video/canvas/WebGL usage anywhere in the app.
- `PlayerHeadshot.tsx` lazily falls back to initials on a 404 rather than retrying, and has an explicit `isSyntheticId` short-circuit added earlier this session to avoid a guaranteed-404 request for D/ST rows with a negative synthetic ID — a real, already-fixed instance of "don't download something you know will fail."
- Not deeply audited: whether `next/image` responsive-size generation is used consistently vs. plain `<img>` for user-uploaded content (team/owner logos) — a few call sites (this session's `MatchupScoreHeader.tsx`, the existing chat `Avatar`) use a plain `<img>` deliberately for externally-hosted URLs `next/image` can't optimize (Vercel Blob URLs). This is a correct, intentional exception, not an oversight — flagged so it isn't mistaken for one in a future pass.

---

## 19. Performance metrics — baseline vs. target

**Everything in this section is a code-derived estimate, not a live measurement.** No Lighthouse/DevTools/React Profiler session was available in this environment. Real numbers should be captured on a real device before and after the optimization plan ships (see the companion Performance Budget doc for the exact protocol).

| Metric | Current (estimated from code) | Target |
|---|---|---|
| Client network requests during an idle live-game window (tab hidden), per minute | ~2 (one `router.refresh()` roundtrip ≈45s cadence + one roster poll ≈15s cadence, both continuing while hidden) | 0 (paused while hidden) |
| Simultaneous infinite CSS animations on the matchup screen | 4-5 (`.neon-panel` instances) | Same visual, verified GPU cost after §17's fix — target a measured, not assumed, improvement |
| WebSocket connections per user (worst case: chat + gamecast + draft all open, which can't happen simultaneously by page) | ≤2 realistic (Presence + one page-scoped socket) | No change needed |
| Backend ESPN calls when nobody is watching Gamecast during a live game | 0 (already true) | 0 |
| Realtime connection count, server-side, per active game | 1 broadcast fan-out per subscribed client (WS), 1 poll job regardless of viewer count | No change needed |

---

## 20. Battery scorecard

| Category | Current | Target | Primary reasons |
|---|---|---|---|
| CPU | B | A | Mostly clean; 1s local clocks are cheap but numerous |
| Network | B | A | Two unconditional polling loops during live games (§2/§3) |
| Memory | A- | A | No leaks found; one unbounded SW cache (§11/§14) |
| Realtime | A- | A | Architecture is already close to ideal (Gamecast); client-side live-fantasy-score polling should join it |
| Polling | B | A | Same two loops as Network; everything else is well-gated |
| Animations | C+ | B+ | `.neon-panel`'s infinite glow is the one real default-experience cost; reduced-motion is correctly wired everywhere it's checked |
| Database | A- | A | One real N+1 already found and fixed this session; legacy paths unaudited (watch item) |
| PWA | A | A | Service worker and push are both already minimal and event-driven |
| Mobile | B+ | A | Same root causes as Network/Animations — nothing mobile-specific beyond those |
| Background activity | C | A | The two unconditional polling loops are the entire gap here |

**Overall current: B-. Target: A-.** The gap is concentrated in exactly two behaviors (visibility-unaware polling, the default glow animation), not a systemic architecture problem.

---

## 21. Prioritization

| # | Finding | Priority | Action |
|---|---|---|---|
| 1 | `GameDayRefresher.tsx` — 45s full-page refresh, no visibility gate | **P0** | Fix now |
| 2 | `MyTeamApp.tsx` — 15s roster poll during game day, no visibility gate | **P0** | Fix now |
| 3 | `.neon-panel::before` — infinite 5s glow animation, no scoping for "many on screen," no pause when off-screen | **P1** | Fix during next refactor (needs a real before/after GPU measurement, not a blind change) |
| 4 | GamecastShell keeps processing/re-rendering incoming WS frames while backgrounded (connection itself is fine to stay open) | **P2** | Fix during next refactor |
| 5 | Service worker `API_CACHE` has no eviction — unbounded growth over a long session | **P2** | Fix during next refactor |
| 6 | Live fantasy score (My Team) should be WS-pushed like Gamecast instead of polled | **P2** | Fix during next refactor — real architecture improvement, not urgent |
| 7 | AdminOverview polling, no visibility gate | **P3** | Monitor (admin-only, single viewer) |
| 8 | No virtualization on any list | **P4** | Do not change — not a real problem at current data volumes |
| 9 | Legacy `get_roster`/`get_rosters` N+1 shape unaudited | **P3** | Monitor |
| 10 | Cross-account SW cache bleed on device reuse, unverified | **P3** | Monitor / verify |

---

## 22. What this audit deliberately did *not* do

Per instruction: no code was changed while producing this document. No timer was "randomly" shortened, no component was "randomly" memoized, no realtime feature was downgraded to polling, and no animation was removed outright — every recommendation in the companion optimization plan is scoped to the specific, evidenced findings above, with a stated test plan and success metric for each.
