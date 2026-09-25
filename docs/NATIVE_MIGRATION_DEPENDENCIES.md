# Native Migration Dependency Audit — Weekend League

Companion to `docs/NATIVE_MIGRATION_AUDIT.md`. Covers every dependency in
`frontend/package.json` and every `backend/requirements*.txt` file, evaluated for
React Native/Expo (iOS + Android) compatibility.

## Framing

The backend (FastAPI/Python) stays a server regardless of the native migration — it is
never imported as a library into the mobile app, only consumed over HTTP/WebSocket. So
for backend dependencies, "is this pip package iOS/Android compatible" is not a
meaningful question the way it is for frontend packages; what matters instead is
whether a dependency implements a **client-facing protocol** that itself has no native
equivalent (this applies to exactly one dependency: `pywebpush`, covered below).

The frontend (Next.js/React web) dependencies are the ones that matter most, since a
native rewrite replaces the entire rendering layer (no DOM, no Next.js runtime).

## Frontend (`frontend/package.json`)

| Package | Purpose | Currently used by | Web compatible? | iOS compatible? | Android compatible? | Native replacement | Migration notes |
|---|---|---|---|---|---|---|---|
| `next` 16.3.1 | Framework: SSR, App Router, routing, bundling | Entire app | Yes | No | No | Expo Router or React Navigation | Next.js is inherently web (Node SSR, file-based routing, `<Link>`/`<Image>`, middleware). Nothing carries over; routing/data-fetching layer must be rebuilt from scratch. |
| `react` 19.2.8 | UI runtime | Entire app | Yes | Yes (via react-native) | Yes (via react-native) | `react-native` (same React version line) | React itself (not react-dom) has a direct RN equivalent. Component logic/hooks are the most reusable part of the codebase if written framework-agnostically (no inline DOM APIs). |
| `react-dom` 19.2.8 | DOM renderer | Entire app | Yes | No | No | `react-native`'s own renderer (host views) | Replaced outright; no shared code. |
| `@capacitor/core`, `@capacitor/android`, `@capacitor/ios`, `@capacitor/assets`, `@capacitor/cli` | Wraps the live Next.js site in a native WebView shell | Existing "mobile app" builds (already shipped) | N/A (native shell, not a web lib) | Yes (current strategy) | Yes (current strategy) | N/A — mutually exclusive with RN/Expo | **This is the app's existing native strategy today**, and it is NOT React Native. Capacitor wraps the deployed web app in a WebView; Expo/RN is a fully separate native rendering layer with no WebView. Moving to Expo/RN means retiring Capacitor for whichever platforms the RN app covers, not building on top of it — this decision should be made explicitly (see audit §18), not incrementally. |
| `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` | Drag-and-drop — used in exactly 2 places: home dashboard card reordering, bottom-nav item reordering (not the draft room, which uses buttons) | `HomeCardDeck.tsx`, `settings/NavigationSection.tsx` | Yes | No | No | `react-native-gesture-handler` + `react-native-reanimated`, or `react-native-draggable-flatlist` | Built entirely on DOM drag events/pointer APIs; zero portable code. Small surface area (2 components) keeps this a low-effort rewrite despite zero portability. |
| `@livekit/components-react` | Prebuilt React UI components for LiveKit (video/voice) | Watch Party feature | Yes | No | No | `@livekit/react-native` SDK | Web-only component library (DOM video elements, web media APIs). Needs LiveKit's dedicated RN SDK, not this package. |
| `@livekit/components-styles` | CSS for the above | Same feature | Yes | No | No | N/A (RN has no CSS) | Discarded; the RN SDK ships its own native styling approach. |
| `livekit-client` | Core LiveKit JS client (WebRTC signaling/media) | Same feature | Yes | Partial | Partial | `@livekit/react-native` (wraps `livekit-client` core + native WebRTC bindings) | LiveKit's RN SDK depends on `livekit-client` under the hood but pairs it with `react-native-webrtc`; the plain web client alone will not work in RN — need the official RN package, not this one directly. |
| `@vercel/blob` | Blob storage client (chat image/GIF uploads, league logo uploads) | Upload flows in `app/api/chat/upload`, `app/api/settings/logo-upload` | Yes | Likely, with caveats | Likely, with caveats | Keep — verify at RN build time | Fetch/`undici`-based with a `browser` field remapping `undici`→browser fetch, `crypto`/`stream`→browser shims — a good portability sign. But Metro (RN's bundler) doesn't honor the `browser` package.json field the way webpack/Next do, and RN lacks Node's `crypto`/`stream` globals. Expect to need `react-native-url-polyfill`/manual polyfills, or to call the Vercel Blob HTTP API directly with `fetch` rather than importing this SDK. Needs a smoke test before relying on it. |
| `@tailwindcss/postcss`, `tailwindcss` | Utility CSS | All styling | Yes | No | No | NativeWind (Tailwind-like API on RN `StyleSheet`) | No CSS engine in RN. NativeWind can reuse *class-name authoring conventions*, but every className must be re-verified against RN's more limited style/layout model (flexbox-only, no CSS grid, limited selectors, no `hover:`). |
| `playwright` | E2E browser testing | CI/test suite (installed but no actual test suite exists in this repo today) | Yes | No | No | Detox, Maestro, or Expo's own E2E tooling | Browser automation doesn't apply to native binaries; a native test suite is written fresh, not ported. |
| `eslint`, `eslint-config-next`, `typescript`, `@types/node`, `@types/react`, `@types/react-dom` | Lint/type tooling | Whole repo | Yes | Yes (portable) | Yes (portable) | Same tools, drop `eslint-config-next` for an Expo/RN lint config | Fully portable dev tooling; only the Next-specific ESLint config needs swapping. |

## Backend (`backend/requirements.txt`, `requirements-chug-analyzer.txt`, `requirements-dev.txt`)

No per-package native-compatibility rows — see framing note above. One substantive
callout:

- **`pywebpush==2.4.0`** implements **VAPID-based Web Push**, wired to
  `backend/app/routers/push.py`, `backend/app/notifications/dispatcher.py`, and the
  frontend's `ServiceWorkerRegistration.tsx`/`lib/push.ts`. Web Push (Service Workers +
  `PushManager` + VAPID) is a **browser-only protocol** — it has no equivalent inside a
  native iOS/Android binary (no Service Worker, no `Notification` API in that sense). A
  native app requires an additive delivery path: **Apple Push Notification service
  (APNs)** and **Firebase Cloud Messaging (FCM)**, most practically integrated via
  **Expo Notifications** (`expo-notifications`) client-side, paired with either Expo's
  push relay or direct APNs/FCM server SDKs alongside (not replacing) `pywebpush`
  server-side, since the web app keeps using the VAPID path.
- Everything else — `fastapi`, `asyncpg`, `alembic`, `psycopg2-binary`, `espn_api`,
  `apscheduler`, `httpx`, `pyjwt`, `bcrypt`, `anthropic`, `boto3` — is ordinary
  server-side infrastructure (DB, scheduling, auth, HTTP client, third-party API SDKs)
  with no client-facing protocol constraint. These keep running exactly as-is behind the
  same REST API regardless of what renders the UI.
- `requirements-chug-analyzer.txt` (mediapipe, opencv, moviepy, etc.) is an isolated
  computer-vision pipeline run server-side in a separate Python 3.11 venv, invoked as a
  subprocess from the main backend process — irrelevant to client platform choice; only
  its HTTP-facing upload/result contract matters to any client.
- `requirements-dev.txt` (pytest, pytest-asyncio) is server-side test tooling, no
  client relevance.

## Bottom line

The frontend stack is Next.js + React DOM + Tailwind + dnd-kit + the Capacitor-webview
wrapper — every one of those except plain React itself is either web-only or represents
the strategy an RN migration would replace. An Expo/RN migration means a full rewrite of
the rendering, routing, drag-and-drop, and styling layers, plus swapping Capacitor for
Expo/RN tooling, LiveKit's web SDK for its RN SDK, Web Push for APNs/FCM, and Playwright
for Detox/Maestro (net-new, since no Playwright suite currently exists). The backend
requires no per-dependency changes beyond adding a native push-notification delivery
path alongside `pywebpush`.
