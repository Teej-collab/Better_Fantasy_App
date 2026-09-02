import { API_BASE_URL } from "@/lib/api";

// Must match sw.js's own API_CACHE constant exactly — that file can't
// import this one (it's a plain worker script, not a module in this
// bundle), so the name is deliberately duplicated here rather than
// shared, with this comment as the tripwire if either one ever changes.
const SERVICE_WORKER_API_CACHE = "wl-api-cache-v1";

// The one real logout implementation — clears both cookies (the
// backend's own, on railway.app, still needed for direct browser-
// >backend calls that haven't been proxied like the chat WebSocket;
// and the frontend's first-party copy every server-rendered page
// actually reads — see app/auth/logout/route.ts). Every caller
// (AccountMenu's Log Out item, Account & Security's Log Out button)
// awaits this, then handles its own router.push("/") + router.refresh()
// — this module has no router dependency, so it works the same from
// any client component.
//
// Also clears the service worker's own cache of authenticated API
// responses (sw.js's wl-api-cache-v1 — draft state, chat conversations,
// notification prefs, everything proxied through /api/backend/*).
// Without this, that cache survived logout indefinitely; on a shared
// device, the next person to sign in could be served the previous
// account's private data from it the moment any of those requests hit
// a network hiccup (2026-09 security audit). The Cache API is available
// from the page itself, not just inside the worker, so this needs no
// postMessage round-trip — best-effort and non-fatal: a browser/context
// without Cache API support (or simply no service worker registered)
// must never block the rest of logout.
export async function clearSession(): Promise<void> {
  await Promise.all([
    fetch(`${API_BASE_URL}/auth/logout`, { method: "POST", credentials: "include" }),
    fetch("/auth/logout", { method: "POST" }),
    typeof caches !== "undefined" ? caches.delete(SERVICE_WORKER_API_CACHE).catch(() => {}) : Promise.resolve(),
  ]);
}
