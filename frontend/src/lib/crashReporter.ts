import { Capacitor } from "@capacitor/core";

import { detectDeviceType, detectPlatform, getSessionId } from "@/lib/analyticsEvents";
import { trackAnalyticsEvent } from "@/lib/api";

// Crash detection for a page that can't catch its own death. When iOS
// kills the WebView for using too much memory, no JavaScript runs — no
// error, no unload event. So every page load leaves a "still open"
// beacon in localStorage, refreshes it while visible, and marks it
// clean whenever the page is hidden or unloaded (backgrounding the app,
// switching tabs, reloading, closing). On the next launch, a beacon
// that was never marked clean and has gone quiet means that page died
// while someone was looking at it — reported then as an app_crash
// event (backend/app/analytics/taxonomy.py, GET /admin/crashes).
//
// Keyed by page load, not one shared slot, so a second browser tab
// opening doesn't mistake the first (still alive) tab for a crash: a
// live, visible tab refreshes its beacon every HEARTBEAT_MS, so only a
// beacon quiet for longer than STALE_MS counts.

const STORAGE_KEY = "wl_crash_beacons";
const HEARTBEAT_MS = 10_000;
const STALE_MS = 30_000;
// Routes kept per beacon — the page that died plus the few before it.
const TRAIL_LENGTH = 4;
const MAX_TRAIL_CHARS = 200;

type Beacon = { start: number; t: number; clean: boolean; trail: string[] };
type Beacons = Record<string, Beacon>;

function readBeacons(): Beacons {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeBeacons(beacons: Beacons): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(beacons));
  } catch {
    // Storage blocked or full — crash reporting just goes quiet.
  }
}

export function osVersion(): string {
  const ua = navigator.userAgent;
  const ios = ua.match(/OS (\d+)_(\d+)/);
  if (/iPhone|iPad|iPod/.test(ua) && ios) return `iOS ${ios[1]}.${ios[2]}`;
  const android = ua.match(/Android ([\d.]+)/);
  if (android) return `Android ${android[1]}`;
  return "other";
}

// Screen points + pixel ratio — the closest a web page can get to the
// phone model (375x667@2 is an iPhone 6/7/8/SE, 414x896@2 an XR/11…).
export function screenSize(): string {
  return `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}`;
}

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function report(beacon: Beacon, now: number): void {
  const route = beacon.trail[beacon.trail.length - 1] ?? null;
  void trackAnalyticsEvent({
    session_id: getSessionId(),
    event_name: "app_crash",
    event_type: "feature",
    route,
    metadata: {
      trail: beacon.trail.join(" › ").slice(-MAX_TRAIL_CHARS),
      uptime_s: Math.round((beacon.t - beacon.start) / 1000),
      silent_s: Math.round((now - beacon.t) / 1000),
      os: osVersion(),
      screen: screenSize(),
      native: isNative(),
    },
    device_type: detectDeviceType(),
    platform: detectPlatform(),
  });
}

/**
 * Starts crash tracking for this page load and reports any earlier
 * load that died. Returns the route updater and a cleanup function.
 */
export function startCrashReporter(initialRoute: string): { setRoute: (route: string) => void; stop: () => void } {
  const id = crypto.randomUUID();
  const now = Date.now();

  // Report (and drop) every earlier load that died; clear out clean
  // ones. A fresh, unclean beacon is another tab that's still open.
  const beacons = readBeacons();
  for (const [key, beacon] of Object.entries(beacons)) {
    if (!beacon || typeof beacon.t !== "number" || !Array.isArray(beacon.trail)) {
      delete beacons[key];
    } else if (beacon.clean) {
      delete beacons[key];
    } else if (now - beacon.t > STALE_MS) {
      delete beacons[key];
      report(beacon, now);
    }
  }

  const mine: Beacon = { start: now, t: now, clean: document.visibilityState !== "visible", trail: [initialRoute] };
  beacons[id] = mine;
  writeBeacons(beacons);

  // Re-read before every write so another tab's beacons survive.
  function save(): void {
    const all = readBeacons();
    all[id] = mine;
    writeBeacons(all);
  }

  let timer: ReturnType<typeof setInterval> | null = null;

  function heartbeat(): void {
    mine.t = Date.now();
    save();
  }

  function onVisibility(): void {
    if (document.visibilityState === "visible") {
      mine.clean = false;
      heartbeat();
      if (timer === null) timer = setInterval(heartbeat, HEARTBEAT_MS);
    } else {
      markClean();
    }
  }

  function markClean(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    mine.clean = true;
    mine.t = Date.now();
    save();
  }

  if (!mine.clean) timer = setInterval(heartbeat, HEARTBEAT_MS);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", markClean);

  return {
    setRoute(route: string) {
      if (mine.trail[mine.trail.length - 1] === route) return;
      mine.trail = [...mine.trail, route].slice(-TRAIL_LENGTH);
      save();
    },
    stop() {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", markClean);
      markClean();
    },
  };
}
