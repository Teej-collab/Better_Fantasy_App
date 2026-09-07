# THE WEEKEND — Performance Budget

Companion to the audit and optimization plan. These are the targets to hold the app to going forward — a mix of **hard rules** (violate these and something is wrong) and **measured targets** (validate on a real device; the audit's own numbers are code-derived estimates, not measurements).

## Hard rules (no exceptions without a documented reason)

1. **No recurring client-side timer or poll may run while `document.visibilityState !== "visible"`**, unless it's a WebSocket connection specifically kept open for fast resume (per `02_Realtime_Strategy.md`) — and even then, incoming data should not trigger a re-render while hidden.
2. **No client-side polling loop may duplicate data a WebSocket channel already pushes.** If a WebSocket already carries the data, use it — don't also poll "just in case."
3. **Any request expected to take longer than ~60 seconds on a slow connection must stream data (or heartbeats) back to the client**, so it can never be indistinguishable from an idle connection to Railway's edge proxy (real 5-minute no-data cutoff, confirmed via Railway's own documentation and one real production incident this session).
4. **Every new CSS animation intended to run continuously (`animation-iteration-count: infinite` or equivalent) must be added to both reduced-motion gates** (`prefers-reduced-motion` media query and the app's `.motion-reduced` class) in the same change that introduces it.
5. **No new backend endpoint that iterates a list and issues one query per item** (the N+1 shape already found and fixed once in `matchup_context.py`) — batch it in the same change, following the `get_teams`/`get_current_rosters` pattern already established in `app/queries/league.py`.
6. **No push notification logic may be driven by polling** — push is event-driven from a real state change, full stop, matching the current `sw.js`/`lib/push.ts` design.

## Measured targets (validate before/after any optimization-plan item ships)

| Target | Threshold | How to measure |
|---|---|---|
| Client network requests while backgrounded during a live game | 0 | Manual device test: open during a live/simulated game window, background for 2+ minutes, inspect Railway access logs for that session's requests in the window |
| Realtime WebSocket connections per user, worst case | ≤ 2 simultaneous (Presence + one page-scoped channel) | Code review — the four channels in `02_Realtime_Strategy.md` are mutually exclusive by page except Presence |
| Backend ESPN/Gamecast calls when no one is watching a live game | 0 | Already true — `app/scheduler.py`'s `_run_gamecast_poll_job` gate; re-verify after any change to that file |
| `.neon-panel` animation compositor cost, 5-panel page, mobile CPU throttle | A measured reduction from the recorded baseline (see optimization plan P1) — no fixed number until the baseline is captured | Chrome DevTools Performance recording, throttled mobile CPU profile |
| Service worker API cache entry count, long session | ≤ 100 (proposed cap, optimization plan P2-2) | `caches.open('wl-api-cache-v1').then(c => c.keys()).then(k => k.length)` in DevTools after extended use |
| Chug upload success rate for a large file on a slow connection | No connection-idle failures ("Load failed") for uploads that are actively transferring or being analyzed | Manual test with network throttling; already fixed this session via streaming heartbeats — this is the regression check |

## Bundle / load budget (baseline, not yet measured in this pass)

No JS bundle size or Core Web Vitals baseline was captured in this audit (no Lighthouse/build-analyzer run was available in this environment). Before the next redesign of a heavy page (matchup screen, free agents, draft board), capture:

- `next build`'s own route-size output (already visible in every build log — e.g. this session's builds show the full route list, but not yet the per-route JS size, which `next build` does report and should be watched for regressions)
- A Lighthouse mobile run against the deployed Vercel URL for the three heaviest pages (Home, Matchup detail, Draft room)

Set specific KB/ms targets once that baseline exists — publishing a target with no baseline to compare against isn't a real budget, it's a guess.

## Realtime/polling budget

- **Maximum client-initiated poll cadence for any feature:** none should exist after the optimization plan's P0/P2-3 items ship — every "live" feature should be WebSocket-pushed, matching Gamecast. Until then, the two remaining polls (`GameDayRefresher` 45s, `MyTeamApp` 15s) must be visibility-gated (P0-1/P0-2) as a floor, even before the fuller WebSocket migration (P2-3) is scheduled.
- **Maximum backend poll cadence against a third party (ESPN):** 60s for fantasy score sync, 4s for live play-by-play — both already gated on real game windows and (for Gamecast) real active viewers. Do not lower either without a specific, stated product reason — both are already tuned against ESPN's rate-limit risk (noted in the scheduler's own comments).

## Background activity budget

- **Zero** background network activity from the client while `document.visibilityState !== "visible"`, once the optimization plan's P0 items ship. This is the single number that should define "did the battery fix work" — if a background tab/PWA shows zero requests during a live game window in server logs, the fix is verified; if it shows any, it isn't.
- **Zero** background CPU work beyond what a held-open WebSocket's keep-alive requires — no client-side timer should tick while hidden except the ones that are pure local math with no re-render cost worth avoiding (the various 1-second countdown clocks — cheap enough to leave running, per the audit's own finding that they cost nothing beyond a `Date.now()` subtraction).
