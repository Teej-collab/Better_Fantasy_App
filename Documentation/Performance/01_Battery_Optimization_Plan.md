# THE WEEKEND — Battery Optimization Plan

Companion to `00_Battery_Performance_Audit.md`. Every item below is scoped to a specific, cited finding from that audit — nothing here is speculative cleanup. **No code has been changed yet; this is the plan for approval.**

Ordering follows the audit's P0→P3 priority. P4 items are intentionally excluded (the audit's own recommendation is "do not change").

---

## P0-1: Visibility-gate `GameDayRefresher.tsx`

**Problem:** During any live NFL game, this component calls `router.refresh()` — a full server round-trip that re-runs every server-component data fetch on the current page (standings, ticker, matchup context, chug leaderboard, NFL scoreboard, etc.) — every 45 seconds, indefinitely, with no check on whether the tab/PWA is actually visible.

**Root cause:** The component was built to answer "is a real game live" (via `isNflGameLive`, checked once server-side before mounting it at all) but never asked the follow-up question "and is anyone actually looking right now." `document.visibilityState` is never read here.

**Current behavior:** Mounts only when `isGameDay` is true (correct), then polls unconditionally for as long as it stays mounted — which, for an unattended backgrounded tab during a Sunday slate, could be several hours.

**Proposed solution:**
```tsx
useEffect(() => {
  let id: ReturnType<typeof setInterval> | null = null;

  function startOrStop() {
    if (document.visibilityState === "visible") {
      if (id === null) {
        router.refresh(); // catch up immediately on return
        id = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
      }
    } else if (id !== null) {
      clearInterval(id);
      id = null;
    }
  }

  startOrStop();
  document.addEventListener("visibilitychange", startOrStop);
  return () => {
    document.removeEventListener("visibilitychange", startOrStop);
    if (id !== null) clearInterval(id);
  };
}, [router]);
```

**Why it helps:** Eliminates 100% of this component's network/CPU cost while the tab is hidden or the PWA is backgrounded — which, based on typical "leave it open and check back" usage during a multi-hour football slate, is likely the majority of this component's currently-active lifetime. Refreshing immediately on return keeps the "stale data on return" gap from §5 of the audit closed for free.

**Potential side effects:** None expected — `router.refresh()` on return is strictly more correct than what happens today (today, returning to a hidden-then-visible tab shows whatever the last background tick fetched, which is already up to 45s stale; this makes it fresher, not staler).

**Files affected:** `frontend/src/components/GameDayRefresher.tsx`

**Test plan:**
1. Unit/manual: mount with a mocked `document.visibilityState`, toggle `visibilitychange`, assert `router.refresh` is called on the leading edge of becoming visible and the interval is cleared while hidden.
2. Manual device test: open the app during a real or simulated live-game window, background the tab for 2+ minutes, confirm (via Network panel / server access logs) zero requests during that window, then confirm one immediate refresh on foreground.
3. Regression: confirm the ticker/scores still update every 45s while genuinely foregrounded, unchanged from today.

**Success metric:** Zero `router.refresh()`-triggered network activity while `document.visibilityState !== "visible"`, verified via Railway access logs correlating request timestamps against a manual background/foreground test window.

---

## P0-2: Visibility-gate `MyTeamApp.tsx`'s live-poll effect

**Problem:** Same pattern as P0-1 — polls `getMyTeam()` every 15 seconds during any live game, unconditionally on visibility.

**Root cause:** Identical to P0-1 — `isGameDay` is checked, `document.visibilityState` is not.

**Current behavior:** `frontend/src/components/MyTeamApp.tsx:237-245`.

**Proposed solution:** Same `visibilitychange`-gated interval pattern as P0-1, applied to this effect. Given this effect already depends on `[isGameDay]`, the visibility check composes cleanly:
```tsx
useEffect(() => {
  if (!isGameDay) return;
  let id: ReturnType<typeof setInterval> | null = null;

  function poll() {
    getMyTeam().then(setTeam).catch(() => {});
  }
  function startOrStop() {
    if (document.visibilityState === "visible") {
      if (id === null) {
        poll();
        id = setInterval(poll, LIVE_POLL_INTERVAL_MS);
      }
    } else if (id !== null) {
      clearInterval(id);
      id = null;
    }
  }

  startOrStop();
  document.addEventListener("visibilitychange", startOrStop);
  return () => {
    document.removeEventListener("visibilitychange", startOrStop);
    if (id !== null) clearInterval(id);
  };
}, [isGameDay]);
```

**Why it helps:** Same reasoning as P0-1, applied to the second (and last) unconditional client polling loop in the app.

**Potential side effects:** None expected.

**Files affected:** `frontend/src/components/MyTeamApp.tsx`

**Test plan:** Same three-part plan as P0-1, scoped to My Team's roster endpoint.

**Success metric:** Zero `GET /me/team` requests while `document.visibilityState !== "visible"`, verified the same way as P0-1.

---

## P1: Scope `.neon-panel::before`'s infinite glow animation

**Problem:** Every `.neon-panel` element runs an infinite 5-second CSS animation (conic-gradient rotation, masked, using a registered `@property` for smooth interpolation) for as long as it's on screen. Pages with several panels (the just-shipped matchup redesign: 4-5 at once) run that many independent instances simultaneously, all day, whenever the app is open — this is the one real cost in the app's *default* (non-reduced-motion) experience.

**Root cause:** The animation was designed per-panel with no consideration for "how many panels does a typical page actually show at once," and no `content-visibility`/off-screen pause.

**Current behavior:** `frontend/src/app/globals.css:221-248`. Already correctly disabled under both `prefers-reduced-motion` and the app's own `.motion-reduced` setting — this plan does **not** touch that gating, only the *default* (motion-on) cost.

**Proposed solution (needs a real before/after measurement before committing to a specific technique — see test plan):** Two candidate approaches, in order of preference:
1. **`content-visibility: auto` + `contain-intrinsic-size`** on `.neon-panel`, so an off-screen panel's `::before` animation is skipped by the browser entirely until it's scrolled into view (zero code-behavior change, pure CSS, browser-native "don't animate what nobody can see").
2. If (1) doesn't recover enough cost on a real device profile: reduce the animation's simultaneous-instance cost directly — e.g., a shared, single animated CSS custom property driven by one `@keyframes` at the `:root` level that every panel's `::before` reads via `var()`, rather than N independent animation instances each maintaining their own timeline. (This is a real architecture change to how the effect is driven, not a visual change — same glow, computed once instead of N times.)

**Why it helps:** Directly reduces the one real, provable "runs forever, multiplies with page complexity" GPU/compositor cost identified in the audit, without touching the app's visual identity or the reduced-motion accessibility path.

**Potential side effects:** `content-visibility: auto` can affect layout/measurement APIs (`getBoundingClientRect`, focus scrolling) for off-screen content in some browsers — needs a real cross-browser check, not just Chrome, especially on Safari/iOS given this is a mobile-first PWA. The shared-keyframe approach (option 2) is lower-risk but a bigger diff.

**Files affected:** `frontend/src/app/globals.css`

**Test plan:**
1. **Measure first** (per the audit's own "do not optimize blindly" instruction): capture a Chrome DevTools Performance recording of the matchup screen (5 panels) on a throttled mobile CPU profile, note main-thread and compositor time attributable to the animation.
2. Apply option 1, re-measure the same recording, compare.
3. If insufficient, apply option 2, re-measure.
4. Visual regression: confirm the glow still looks identical when panels are on-screen, in both light/dark and both Calm/Cosmic appearance modes.
5. Confirm reduced-motion (both OS-level and app-level) still fully disables the animation — this plan must not weaken that existing, correct gating.

**Success metric:** Measured reduction in compositor/GPU time attributable to `.neon-panel::before` on a 5-panel page, confirmed via before/after Performance recordings — target a real percentage reduction from the measured baseline, not a blind guess.

---

## P2-1: Pause GamecastShell's frame processing while backgrounded

**Problem:** The WebSocket connection itself is correctly exempt from Railway's idle-connection timeout and doesn't need to close — but the client keeps calling `setGame()` (triggering a re-render of the whole Gamecast tree) for every incoming frame even while the tab is hidden.

**Root cause:** `GamecastShell.tsx`'s `onmessage` handler has no visibility check.

**Current behavior:** `frontend/src/components/gamecast/GamecastShell.tsx:70-79`.

**Proposed solution:** Keep the socket open (do not touch connection lifecycle), but skip the `setGame` state update — and therefore the re-render — while hidden; apply the latest-received frame once on return to visible:
```tsx
const latestFrame = useRef<LiveGame | null>(null);
socket.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    if (data.type === "game_state" && data.game) {
      latestFrame.current = data.game as LiveGame;
      if (document.visibilityState === "visible") setGame(data.game as LiveGame);
    }
  } catch { /* ignore malformed frame */ }
};
// separate effect: on visibilitychange back to "visible", flush latestFrame.current into setGame if present
```

**Why it helps:** Removes wasted re-render work (and the 1s clock ticker riding along with it) while the user isn't looking, with zero loss of freshness on return (the latest frame is applied immediately).

**Potential side effects:** None expected — this is purely a "when to apply already-received state" change, not a data-freshness change.

**Files affected:** `frontend/src/components/gamecast/GamecastShell.tsx`

**Test plan:** Manual — open a live Gamecast page, background the tab, use dev tools (remote debugging) or a log line to confirm no `setGame` calls fire while hidden, confirm the displayed state matches the true latest game state within one visibility toggle of returning.

**Success metric:** Zero Gamecast re-renders while `document.visibilityState !== "visible"`; state freshness on return unchanged (already-current within the WS's normal push latency).

---

## P2-2: Cap the service worker's API cache

**Problem:** `wl-api-cache-v1` (`public/sw.js`) grows without bound — every distinct GET URL through `/api/backend/*` is cached forever until a full version-name bump wipes everything.

**Root cause:** No per-entry expiry or LRU eviction was implemented — the cache was designed for "give me the last good response on a network failure," which doesn't require pruning until the failure-fallback use case is considered over a long session.

**Current behavior:** `frontend/public/sw.js:26-53`.

**Proposed solution:** Add a lightweight LRU cap (e.g., 100 entries) enforced on every successful cache write — on `cache.put`, check `cache.keys().length` and delete the oldest entry(ies) beyond the cap. This keeps the "stale-but-present on failure" behavior for anything requested recently while bounding storage growth over a season-long session.

**Why it helps:** Prevents unbounded IndexedDB/CacheStorage growth over a long-lived PWA session (a user who never fully closes the app across a season could otherwise accumulate hundreds of player-card/draft-pool entries).

**Potential side effects:** A very-infrequently-revisited URL could fall out of the cache and lose its offline-fallback value sooner than "forever" — acceptable, since the fallback's whole purpose is "recently seen, temporarily unreachable," not permanent offline storage.

**Files affected:** `frontend/public/sw.js`

**Test plan:** Unit-style manual test — trigger 150 distinct cached GETs in a test harness/browser console against a local build, confirm the cache never exceeds the cap, confirm the most-recently-used entries survive eviction.

**Success metric:** Cache entry count bounded at the configured cap under sustained use, verified via `caches.open(API_CACHE).then(c => c.keys()).then(k => k.length)` in DevTools after a long test session.

---

## P2-3: Move live fantasy score updates to WebSocket push

**Problem:** My Team's live game-day roster refresh (P0-2) is client polling for data the backend could push, the same way Gamecast already does.

**Root cause:** This feature was built before (or independently of) Gamecast's push infrastructure and never migrated to match it.

**Current behavior:** Client polls `GET /me/team` every 15s during a live game (once visibility-gated per P0-2, this becomes "every 15s while visible," which is a real fix on its own — this item is the *further* improvement, not a blocker for P0-2).

**Proposed solution:** Extend the existing Gamecast-broadcast pattern (`gamecast_manager.broadcast_to_game`, `app/scheduler.py`) — or a new, analogous per-owner channel — so the same live-sync tick that already recomputes fantasy scores during a game (`_run_live_sync_job`, already running every 60s during live windows) also pushes each affected owner's updated roster state to a subscribed client, replacing the client-side poll entirely.

**Why it helps:** Removes the last client-side polling loop in the app, replacing it with the same event-driven model already proven out in Gamecast — matches the ideal architecture in `02_Realtime_Strategy.md`.

**Potential side effects:** A real architecture change — needs its own design pass (per-owner channel scoping, auth, reconnect behavior) rather than a drop-in patch. Larger effort than everything else in this plan; do not block P0/P1 items on it.

**Files affected:** New backend WS channel (mirroring `app/gamecast/manager.py`'s shape) + `frontend/src/components/MyTeamApp.tsx`.

**Test plan:** Full integration test — verify a real score change during a live-sync tick reaches a connected client within one tick interval, verify reconnect behavior matches Gamecast's, verify the fallback (no WS) still works if the ticket mint fails, same as Gamecast's own "not signed in → falls back" comment already documents as the intended degradation path.

**Success metric:** Client roster-freshness during a live game matches or beats the current 15s polling cadence, with zero client-initiated polling requests.

---

## P3 (monitor, do not fix now)

- **AdminOverview.tsx polling** — admin-only, single viewer. Apply the same visibility-gate pattern as P0-1/P0-2 opportunistically if that file is touched for another reason, but not worth a dedicated change.
- **Legacy `get_roster`/`get_rosters` N+1 shape** — unaudited in this pass, low-traffic historical-data paths. Profile if/when that code path is touched again.
- **Cross-account service worker cache bleed on device reuse** — theoretical, unverified. Write a quick manual test (sign in as user A, cache some data, sign out, sign in as user B on the same device, confirm no stale A data surfaces) before deciding whether it needs a fix.

---

## Sequencing

1. **Ship P0-1 and P0-2 together** — same pattern, same risk profile, both trivial to test, both immediately measurable via server access logs.
2. **Run tests, build, deploy, verify** per the audit's own instruction: confirm realtime (Gamecast, chat, draft, presence), authentication, and mobile behavior are all unaffected — none of these two changes touch those systems, but verify anyway.
3. **Measure the `.neon-panel` animation cost on a real device** before starting P1 — this is explicitly a "measure, identify, change, measure again" item, not a blind CSS edit.
4. **P2 items** are independent of each other and of P0/P1 — sequence by whichever is most convenient to pair with other work already touching that file (e.g., P2-1 pairs naturally with any other Gamecast work; P2-3 is the largest single item and should be scheduled as its own piece of work, not squeezed in).
