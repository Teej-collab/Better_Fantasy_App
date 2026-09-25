# Native Migration Risks — Weekend League

Companion to `docs/NATIVE_MIGRATION_AUDIT.md`. Risks are ranked qualitatively
(Critical / High / Medium / Low) per the audit brief's instruction not to assign
arbitrary numeric scores. Ranking reflects a combination of (a) how likely the risk is
to actually bite during a native migration and (b) how much functionality/trust would
be lost if it did.

---

## Critical

**None identified.** Nothing found in this audit would block the migration outright or
risk catastrophic data loss/security exposure if handled with ordinary care. This is a
direct consequence of the backend's existing native-readiness (Bearer-token auth
already built, all provider secrets already server-only, DB access already
centralized) — the areas that would typically produce a Critical finding in a less
prepared codebase are already in good shape here.

---

## High

**1. Push notifications require new work on both ends of the stack, not just the
client.**
Today's implementation is 100% Web Push (VAPID keypair + browser `PushManager`),
end to end: subscription storage is shaped as a browser `PushSubscription` object
(`endpoint`, `p256dh`, `auth` keys), not an abstracted device-token model, and the send
path calls `pywebpush` directly. A native app cannot reuse any of this — it needs a new
subscription table shape, a new dispatch path (APNs/FCM, likely via
`expo-notifications`), and that new path has to be kept in sync with the existing web
path going forward (two delivery mechanisms to maintain, not one migrated mechanism).
*Why High and not Critical:* it's additive, well-scoped, and doesn't touch anything the
web app currently depends on — but it is real backend engineering work that has to
happen before native push can ship, not just a client-side integration task.

**2. OAuth completion assumes a browser; native needs a different handoff mechanism.**
Discord and Google OAuth both hand the session token to the browser via a URL fragment
landing on a Next.js page built for that purpose. A native app has no equivalent page to
land on — it needs a deep link / custom URL scheme, or an in-app browser session
(`ASWebAuthenticationSession`/Chrome Custom Tabs) that can capture the redirect. Discord
OAuth in particular is the primary onboarding path for existing league members (email/
password and Google are both self-serve alternatives), so if an early native release
needs to support existing members signing in with their existing account, this isn't
optional. *Why High and not Critical:* email/password already works end-to-end via the
existing Bearer-token path with zero additional backend work, so this can be sequenced
rather than blocking all native auth.

**3. Four independent, hand-rolled WebSocket features with no shared client library.**
Chat, draft, gamecast, and presence each implement their own connect/reconnect-with-
backoff/ticket-mint lifecycle in the web app, with small inconsistencies already present
between them (e.g., gamecast falls back to polling for unauthenticated users in a way
the others don't). A native rewrite that ports each of the four independently risks
introducing four subtly different reconnect bugs instead of the current app's already-
inconsistent-but-working four. *Mitigation is straightforward*: build one shared native
WebSocket client (ticket-mint → connect → reconnect → dispatch) once, then have all four
features consume it — this is explicitly called out as the recommended approach in the
migration sequence, not a new discovery requiring further investigation.

---

## Medium

**4. ESPN per-owner cookie collection is an open, unresolved design question with a
worse native UX than web.**
`ESPN_LINEUP_WRITE.md`'s own "open question" section flags that it's unverified whether
one commissioner's ESPN session credentials can write a different team's lineup on
ESPN's servers. If that comes back "no," the documented fallback is per-owner ESPN
cookie storage, "with each owner submitting their own cookies through some UI" — not
built today. Prompting end users to extract and paste raw ESPN session cookies
(`espn_s2`/`SWID`) is an awkward, fragile, and slightly alarming UX pattern on web; on a
native app it's worse (no browser dev-tools access on-device to extract the cookie in
the first place, pushing users toward an even more convoluted copy-paste-from-desktop
workflow). *Why Medium, not High:* this isn't a problem today — no end user is currently
asked for ESPN credentials, and there's no indication the single-operator-credential
model is failing. It's a risk to have on record before native work starts, in case the
underlying ESPN-write question resolves unfavorably later.

**5. LiveKit Watch Party needs a full native SDK integration, not a port.**
The web implementation leans heavily on `@livekit/components-react`'s prebuilt UI
(video conference grid, control bar) plus custom overlays (in-call chat, per-participant
volume panel, a screen-share-with-audio workaround for a control-bar limitation). None
of that UI layer transfers to `@livekit/react-native`; only the backend's token-issuance
logic is reusable. This is a real, if bounded, chunk of native-specific engineering.
*Why Medium:* it's a self-contained feature with a clear boundary (unlike, say, auth,
which touches everything) — it can be sequenced late (Phase 6) without blocking the core
app.

**6. No CI pipeline exists today, and a second client raises the cost of that gap.**
There is no `.github/workflows` or any other CI configuration anywhere in the repo. The
89-file backend pytest suite and any future native test suite both currently rely
entirely on manual pre-merge runs. Adding a native client means backend changes now have
two consumers to regress-test (web and native) instead of one, and a native app's
release cycle (app-store review) makes "ship a fix immediately" much slower than the
web app's instant-redeploy model — raising the value of catching regressions before
release rather than after. *Why Medium, not High:* this is a pre-existing gap the native
migration doesn't create, just makes more expensive to leave unaddressed.

**7. `@vercel/blob`'s React Native compatibility is unverified, not confirmed-incompatible.**
The package is fetch-based with browser-field remapping, which is a good sign, but
Metro (RN's bundler) doesn't honor that remapping the way webpack/Next do, and RN lacks
some Node globals the package's dependency chain may expect. This could turn out to be a
non-issue (or need only a small polyfill), or could require bypassing the SDK entirely
in favor of calling Vercel Blob's HTTP API directly with `fetch`. *Why Medium:* bounded
and likely resolvable either way, but currently unverified — should be smoke-tested
early (Phase 3, when upload features are first touched) rather than assumed.

---

## Low

**8. Design token/theme system needs a new mechanism, but the tokens themselves are
already clean data.**
The web app's theming (`--wl-*` CSS custom properties, `document.cookie`-based
preference storage, an inline boot script to avoid flash-of-unstyled-content) is
entirely CSS/cookie-specific and doesn't port. However, the actual token *values* (color
palette, theme names, "direction" variants) are cleanly enumerable and can be lifted
into a native theme/token module with straightforward, low-risk effort.

**9. Small, self-contained web-only interactions need native equivalents but carry no
architectural risk.**
Canvas-based logo cropping, clipboard-paste image upload in chat, and the two
`@dnd-kit`-based reordering features (home dashboard cards, bottom-nav order) are all
narrow, well-understood pieces of UI with known native replacement libraries
(`expo-image-manipulator`, `expo-image-picker`, `react-native-gesture-handler`/
`reanimated`). None of them touch business logic, auth, or data integrity.

**10. Analytics `page_view` classification assumes a URL route.**
The current taxonomy classifies page views by URL path, which has no direct analog in a
native app with no URL bar. This needs a small taxonomy extension (screen-name-based
events) but is not a structural problem — the ingestion endpoint and the rest of the
event taxonomy are reusable as-is.

**11. Rate limiting is in-memory/per-process, an accepted tradeoff that a native client
doesn't materially worsen on its own.**
This is a known, already-documented limitation (see `ADMIN_SECURITY.md`) tied to running
a single backend instance, not to which clients connect to it. A native app adds a new
traffic source but doesn't change the underlying single-instance assumption; it would
only become relevant if overall traffic growth (from any source) motivated horizontal
scaling.

---

## Explicitly not treated as risks

- **The existing Capacitor WebView wrapper** is not a risk to the migration — it's a
  parallel, already-functioning distribution mechanism. Its future (keep it running
  alongside a native app, or retire it) is an open question (see audit §18), not a
  threat to anything.
- **Domain/scoring logic correctness** is not flagged here because it doesn't move: the
  scoring engine, matchup logic, and award rules all stay exactly where they are today
  (server-side, behind the API), and a native client consumes the same computed results
  the web client does. There is no risk of the native app calculating anything
  differently, because it never calculates fantasy outcomes itself.
