# Android TV Compatibility — Chromecast with Google TV 4K

**Status: PROPOSED. Versions to be verified at Phase 2 start.**

## Target device

- Chromecast with Google TV (4K): Amlogic S905D3 (4× Cortex-A55), 2 GB RAM, Mali-G31.
- Android TV OS 12 (API 31) on current firmware. **minSdk 31** covers it. Consider 28
  if older Android TV boxes matter.
- The UI renders at 1080p. The app does not need 4K assets. Design canvas: 960×540 dp,
  with safe margins of 48 dp horizontal and 27 dp vertical (5%).

## Stack (recommended)

- Kotlin, Jetpack Compose, `androidx.tv:tv-material` (TV Material 3), and Navigation
  Compose.
- Networking: OkHttp (including its WebSocket), kotlinx.serialization, Retrofit or a
  thin hand-written client.
- Images: Coil with downsampled requests. Team avatars are at most 128 px.
- Storage: DataStore for preferences; EncryptedSharedPreferences/Keystore for tokens.
- QR code for pairing: ZXing core, rendered as a bitmap.
- Testing: Compose UI tests with D-pad key injection, Robolectric for logic, and an
  Android TV emulator (API 31+, 1080p).

## Manifest essentials

- `android.software.leanback` set to `required="false"`, plus
  `android.hardware.touchscreen` set to `required="false"`.
- `LEANBACK_LAUNCHER` intent category and a 320×180 `android:banner`.
- Landscape orientation, and `allowBackup="false"`.

## Remote mapping

| Key | Action |
|---|---|
| D-pad left/right | Top nav and horizontal rows |
| D-pad up/down | Vertical content; Up from a top row returns to nav |
| Center | Select |
| Back | Pop the screen. At a root destination it goes to Broadcast, then exits. Back from Broadcast shows an "exit?" toast once. |
| Play/Pause | Pause or resume Broadcast auto-rotation |
| Fast-forward/Rewind | Next or previous rotation view |

- Any key press pauses auto-rotation for a configurable idle time (default 20 s).
- Focus restoration uses `focusRestorer` on each row and saved state per destination.
- There is always exactly one focused element. The default focus target is set per
  screen.

## Performance budgets

- Cold start: under 2.5 s to the first frame with cached data.
- Steady memory: under 180 MB PSS.
- One WS connection. No polling while the WS is healthy.
- Score updates touch only the changed matchup cards (stable keys and `derivedStateOf`).
- Animations: transform and alpha only. No full-screen blur. The light-wedge glow is a
  pre-rendered bitmap.
- A "Reduce motion" setting turns off rotations' crossfade and the score-burst
  animations.

## Distribution

- Sideload: a signed release APK installed with `adb connect <ip>:5555` and
  `adb install`. Developer options must be enabled on the Chromecast.
- Google Play: a TV-specific listing, TV screenshots and banner, and a TV quality
  review. Requires the data-licensing item in SECURITY_REQUIREMENTS.md. **Not
  published without approval.**

## Local tooling gaps (as of audit)

The Mac has no JDK, Android SDK, Android Studio or adb. Phase 2 starts by installing
Android Studio, the TV emulator image and `platform-tools`.
