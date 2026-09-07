# THE WEEKEND — Realtime Strategy

Companion to the audit. This document describes the ideal realtime architecture for this app, validated against what's actually built today rather than a generic template.

## The model that already works: Gamecast

`app/scheduler.py`'s `_run_gamecast_poll_job` is the reference implementation for every other "live" feature in this app:

```
real NFL game window active?  → no  → do nothing, zero cost
        ↓ yes
at least one WebSocket client subscribed to THIS specific game?  → no → do nothing, zero cost
        ↓ yes
poll ESPN (4s cadence) → push game_state to every subscriber via WebSocket
```

The client (`GamecastShell.tsx`) never polls — it opens one WebSocket per game page, receives pushes, and only opens the socket at all for a game that's actually live or about to start (never for a finished game). This closes every loop in the "when to work / when to listen / when to update" philosophy from the audit's own framing:

- **When to work:** only when someone's watching a game that's actually live.
- **When to listen:** the WebSocket, continuously, cheaply (WS connections are exempt from Railway's request-timeout, per Railway's own docs — an open, idle-looking WS is not a battery or infra cost the way a repeated HTTP poll is).
- **When to update:** the moment the server has something new — not on a client-driven timer.
- **When to sleep:** the poll job's own two-layer gate (`is_nfl_game_live` + `live_game_ids()`) means it's asleep by default, not "polling slowly."
- **When to wake back up:** the next scheduler tick re-checks both conditions — no explicit wake logic needed because the gate is re-evaluated every tick anyway.

## Where the rest of the app doesn't match this yet

**Live fantasy score during a game (My Team's on_offense/red-zone flags, `MyTeamApp.tsx`):** currently client-polls `GET /me/team` every 15s during any live game (§2/§3/§9 of the audit). The backend already recomputes this exact data every 60s during a live window (`_run_live_sync_job`) — it just doesn't push it anywhere. This is the one real "should be event-driven and isn't yet" gap. See the optimization plan's P2-3 for the concrete migration.

**The homepage/app-wide ticker (`GameDayRefresher.tsx`):** this one is structurally different from Gamecast — it's not one narrow slice of state (one game), it's "the whole current page's server-rendered content," which doesn't map cleanly onto a single WebSocket payload the way Gamecast's `game_state` does. **Recommendation: do not convert this to a push model.** The right fix here is visibility-gating the poll (P0-1), not architecture change — a full-page server refresh is inherently a "poll and re-render everything" operation, and the fix for that shape is "don't do it when nobody's looking," not "invent a WebSocket payload that represents an entire page."

## Realtime connection inventory (validated)

| Feature | Transport | Scope | Opens when | Closes when |
|---|---|---|---|---|
| Presence | WebSocket | App-wide, one per session | App mounts (`app/layout.tsx`), if signed in | App unmounts / session ends |
| Chat messages/typing | WebSocket | Per-session, only while `/chat` mounted | `/chat` page mounts | `/chat` page unmounts |
| Draft room | WebSocket | Per-session, only while a live draft room is mounted | Draft room mounts, draft not yet finished | Draft room unmounts or draft completes |
| Gamecast | WebSocket | Per-session, only while a specific live/scheduled game's page is mounted | Game page mounts, game not finished | Game page unmounts or game finishes |

No feature opens more than one connection for the same purpose. No connection is left open past the page/feature that needs it, except Presence, which is intentionally app-wide.

## Should subscriptions be centralized?

**Not currently necessary.** The four channels above serve genuinely different data, are mutually exclusive by page (except Presence), and each is already scoped tightly to when it's needed. Centralizing them into one multiplexed connection would trade a small amount of connection overhead (negligible — WebSockets are cheap to hold open, not cheap to constantly open/close) for meaningfully more complexity in routing frames to the right consumer. Revisit only if a fifth realtime feature is added to a page that already has one of the above open.

## Recommended additions

1. **My Team's live score → WebSocket push** (optimization plan P2-3) — the one real gap, follows the Gamecast pattern exactly (per-owner channel instead of per-game, same broadcast-on-tick shape).
2. **GamecastShell should stop applying incoming frames to state while `document.visibilityState !== "visible"`** (P2-1) — the connection itself should stay open (it's cheap and exempt from timeout-driven reconnect churn), but processing/re-rendering on every frame while nobody's looking is wasted work. Apply the latest buffered frame once on return to visible.

## What not to change

Do not add a general-purpose "realtime everything" layer, do not add polling as a "simpler" replacement for any of the four WebSocket features above, and do not lower Gamecast's 4s cadence — it's already conservative against ESPN's undocumented private API and matches "how fast a real play actually resolves." The realtime architecture here is a genuine strength of this codebase; the work is filling the one gap (My Team) and adding visibility-awareness to Gamecast's client-side rendering, not rebuilding anything.
