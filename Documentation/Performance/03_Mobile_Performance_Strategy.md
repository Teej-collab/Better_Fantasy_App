# THE WEEKEND — Mobile Performance Strategy

Companion to the audit. THE WEEKEND is a mobile-first PWA — this document is the mobile-specific slice of the broader optimization plan: what's already right, what isn't, and the standard to hold future work to.

## What's already right for mobile

- **No `requestAnimationFrame` anywhere in the codebase.** All animation is CSS-driven, which lets the browser/GPU compositor handle it off the JS main thread — the correct default for battery on a phone.
- **The entry animation is bounded, sound-aware, and fully respects reduced motion** (both the OS-level `prefers-reduced-motion` media query and the app's own Settings toggle) — see the audit's §6/§16. This does not need mobile-specific rework.
- **Push notifications require an explicit install-to-Home-Screen step on iOS**, and the app tells the user this up front (`lib/push.ts`'s `isIosDevice`/`isInstalledStandalone` check) rather than silently failing to deliver — correct handling of a real, easy-to-miss iOS/WebKit restriction.
- **The service worker's cache strategy is network-first with a narrow scope** (one path prefix), which is the right call for a PWA that's mostly server-rendered — it doesn't try to fake full offline support, which would be both wrong (SSR pages genuinely need the network) and a bigger footprint on the device for no real benefit.
- **Realtime features (Gamecast, chat, draft) use WebSockets, not polling** — on cellular, a held-open WebSocket is meaningfully cheaper than a repeated HTTP poll (no repeated TLS/TCP overhead, no repeated auth-header round trip), and Railway's own docs confirm WS connections are exempt from the request-timeout that HTTP polling would eventually hit anyway on a slow connection.

## What needs mobile-specific attention

**Backgrounding behavior (the audit's central finding):** a phone is backgrounded far more often, and far more silently, than a desktop tab is hidden — locking the screen, swiping to another app, an incoming call, all background the PWA without the user "closing" anything. The two unconditional polling loops (`GameDayRefresher`, `MyTeamApp`'s live poll) are a real mobile-specific cost precisely because "leave the app open in the background during the game" is the single most likely usage pattern for a fantasy football app on a Sunday. Fixing P0-1/P0-2 (visibility gating) is the highest-leverage mobile-specific change available.

**Network variability:** the chug-upload fix shipped earlier this session (streaming heartbeats to survive Railway's 5-minute idle-connection cutoff) is directly a mobile-network-variability fix — a slow/unstable cellular upload was being killed mid-flight and reported as a generic "Load failed." The same class of problem (a request that can legitimately take a long time on a bad connection, with no data flowing back to prove it's still alive) should be the standard check applied to any future long-running mobile-initiated request.

**CSS compositing cost on mobile GPUs:** `.neon-panel::before`'s infinite conic-gradient animation (audit §17) is exactly the kind of effect that's cheap to dismiss on a desktop GPU and meaningfully more expensive on a phone's — mobile GPUs have less headroom, and a page with 4-5 simultaneously-animating instances (the matchup screen) is a realistic worst case, not a hypothetical one. This is the top CSS-specific item to validate on a real device (see the optimization plan's P1 test plan) before deciding between the two proposed fixes.

**Touch/viewport handling:** not flagged as a problem in this pass — `ChatApp.tsx`'s keyboard-aware resize listener and the mobile chat layout work from earlier in this project's history (referenced in existing code comments, e.g. the "Fix composer hidden below the screen" commit) already addressed the known mobile viewport issues. No new findings here.

## Standard for future mobile work

1. **Any new recurring timer or poll must be gated on `document.visibilityState`** unless there's a specific, stated reason it needs to keep running in the background (there currently is no such feature in this app — Presence's WebSocket stays open by design, but it does no polling of its own and reports visibility state to the server rather than hiding it).
2. **Any new long-running request (upload, heavy computation) must either complete quickly or stream partial data/heartbeats** — Railway's real 5-minute no-data-transferred cutoff is a hard constraint for this app's specific hosting, not a theoretical concern (it already caused a real production bug this session).
3. **Any new CSS effect intended to run continuously should be checked against "how many of these could realistically be on screen at once"** before shipping, not after a user reports it feeling heavy — `.neon-panel` is the cautionary example: a fine cost per-instance that wasn't evaluated for the "several instances on one screen" case until reported.
4. **New animations must be added to both reduced-motion gates** (the CSS media query and the app's `.motion-reduced` class) from the start, following the existing pattern (`globals.css`'s reduced-motion block) rather than as a follow-up fix.
