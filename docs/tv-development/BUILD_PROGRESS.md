# The Weekend TV — Build Progress

## Phase 1 — Repository audit (2026-11-14) — DONE, awaiting approval

**Completed:** read the backend, frontend, mobile, migrations and scheduler. Wrote the
architecture docs. Built TV mockups for review (artifact link in chat).

**Files created:**
- `docs/architecture/EXISTING_SYSTEM_AUDIT.md`
- `docs/architecture/TARGET_ARCHITECTURE.md`
- `docs/architecture/DATA_FLOW.md`
- `docs/security/SECURITY_REQUIREMENTS.md`
- `docs/tv-development/ANDROID_TV_COMPATIBILITY.md`
- `docs/tv-development/BUILD_PROGRESS.md`

**Code changes:** none.

**Tests:** none (no code).

**Decisions needed:**
1. TV client technology: Kotlin + Compose for TV (recommended) or Expo
   `react-native-tvos`.
2. Mockup direction sign-off.
3. Whether public league mode is in v1.
4. Data licensing before Play Store distribution (Sportradar quote).

**Outstanding problems:**
- The live feed is unlicensed for redistribution.
- There is no Android toolchain on the Mac yet.

**Next:** Phase 2, the technical foundation, after approval.

## Direction change (2026-11-14)

This is now a personal overhaul of one Chromecast with Google TV, not a
distributed product. Public mode, Play Store and data licensing are out of
scope. Branding stays **The Weekend** with the hive emblem.

## Phase A — First build on the TV (2026-11-14) — IN PROGRESS

**Backend:**
- `migrations/versions/c2e4a6b8d0f1_tv_devices.py`: new tables `tv_devices` and `tv_pairing_codes`.
- `app/routers/tv.py`: pair start, approve and token, refresh, me, and the devices list and disconnect.
- `app/auth/tv_session.py` and the middleware hook in `app/main.py`: a TV token can only read. It never reaches admin routes, and it stops working when the TV is disconnected.
- `app/auth/session.py`: `create_tv_session_token`.
- `app/auth/rate_limit.py`: a pairing rate limit.

**Website:**
- `frontend/src/app/(app)/tv/page.tsx`: the Connect a TV page.
- `frontend/src/lib/tvApi.ts`.

**TV app** (`tv/`, Kotlin, AGP 9.5.1, Compose BOM 2026.09.00, compileSdk 37, minSdk 28):
- Home screen, registered as HOME. It switches between the game-day look and the weekday look based on the real NFL schedule.
- Pairing screen.
- Settings.
- `OverlayService`: a score bug in the top-right and scoring pop-ups, each delayed to match the streaming app.
- `RemoteService`: an accessibility service that handles the learned overlay button and tracks which app is in front.

**Tests:**
- `backend/tests/test_tv_pairing.py`: 5 tests passing. The existing auth, session and share tests (62) also pass. All run against the local test database.
- Frontend `tsc` and `eslint` are clean.
- `./gradlew assembleDebug` builds.

**Outstanding:**
- Deploy the backend and website, and run the prod migration (needs approval).
- Pair adb with the TV.
- Grant the overlay permission and turn on the accessibility service over adb.
- Make our app the TV's home screen.
