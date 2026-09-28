import { detectPlatform } from "@/lib/analyticsEvents";
import { osVersion, screenSize } from "@/lib/crashReporter";

// Sends JavaScript errors from users' devices to Admin > Errors (POST
// /admin/client-error — backend/app/routers/admin.py). Catches
// uncaught errors and unhandled promise rejections globally, plus
// render errors the app's error screen catches (app/error.tsx calls
// reportClientError directly — React handles those itself, so they
// never reach the global handlers).
//
// Deliberately quiet: the same message is sent once per page load, at
// most MAX_PER_LOAD in total, and known noise is dropped (browser
// extensions, cross-origin "Script error.", and plain network drops —
// a phone losing signal mid-request isn't a bug).

const MAX_PER_LOAD = 10;
const IGNORED = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /Load failed/i,
  /Failed to fetch/i,
  /NetworkError/i,
  /The network connection was lost/i,
  /AbortError/i,
  /The operation was aborted/i,
  /^TypeError: cancelled$/i,
];

const sent = new Set<string>();

export function reportClientError(error: unknown, fallbackMessage = "Unknown error"): void {
  if (typeof window === "undefined") return;
  try {
    const err = error instanceof Error ? error : null;
    const message = (err ? `${err.name}: ${err.message}` : typeof error === "string" ? error : fallbackMessage).slice(
      0,
      2000
    );
    const stack = err?.stack ?? null;
    if (IGNORED.some((re) => re.test(message))) return;
    if (stack && /(chrome|moz|safari(-web)?)-extension:\/\//.test(stack)) return;
    if (sent.has(message) || sent.size >= MAX_PER_LOAD) return;
    sent.add(message);

    void fetch("/api/backend/admin/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        message,
        stack: stack?.slice(0, 20000) ?? null,
        route: window.location.pathname.slice(0, 500),
        platform: detectPlatform(),
        os: osVersion(),
        screen: screenSize(),
      }),
    }).catch(() => {});
  } catch {
    // Reporting must never throw into the app.
  }
}

export function startErrorReporter(): () => void {
  function onError(event: ErrorEvent) {
    reportClientError(event.error ?? event.message, event.message || "Uncaught error");
  }
  function onRejection(event: PromiseRejectionEvent) {
    reportClientError(event.reason, "Unhandled promise rejection");
  }
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
