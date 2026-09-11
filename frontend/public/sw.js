// Weekend League's service worker — push notifications, plus a
// deliberately narrow runtime cache for one thing: GET requests
// through the same-origin /api/backend/* proxy (see app/api/backend/
// [...path]/route.ts) — every authenticated client-side data fetch
// this app makes (draft pool/state, free agents, player cards, chat
// conversations, notification prefs, ...) goes through that one path
// prefix. Network-first, falling back to the last cached response on
// failure — a spotty connection on game day (the exact scenario named
// in the 2026-08-31 audit: "a user in a stadium or backyard with bad
// signal") gets stale-but-present data instead of a hard failure.
//
// Deliberately NOT a general offline-app cache: server-rendered page
// loads (the majority of this app's data, including every SSR fetch
// on first paint) run on the server, never through this file at all —
// no service worker in existence can make a from-scratch page load
// work with zero network. This only helps the "already on the page,
// one refetch fails" case, which is the one that actually matters for
// intermittent signal rather than a truly offline device.
//
// skipWaiting()/clients.claim() below mean a newly deployed version of
// this file takes over immediately (next load, no waiting for every
// open tab to close first) — without them, a visitor could stay stuck
// on a stale service worker indefinitely.

const DEFAULT_ICON = "/images/icon-192.png";
const API_CACHE = "wl-api-cache-v1";
// Unbounded before this (2026-09) — every distinct GET URL through the
// proxy (draft pool, free agents, player search, chat history, ...)
// stayed cached for the life of the service worker, potentially all
// session long on a game day with heavy navigation. Cache Storage is
// disk-backed, not JS heap, so this was never the direct cause of a
// JS-side crash, but it's real unbounded growth with no reason to
// allow it. cache.keys() returns entries oldest-first in every engine
// this app ships to (not spec-guaranteed, but true in practice for
// both Chromium and WebKit), so trimming from the front is a reasonable
// best-effort LRU without tracking timestamps ourselves.
const API_CACHE_MAX_ENTRIES = 60;

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - API_CACHE_MAX_ENTRIES;
  if (excess > 0) {
    await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/api/backend/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache a genuinely good response — never let a 401/404/5xx
        // overwrite a real previously-cached success.
        if (response.ok) {
          const copy = response.clone();
          caches.open(API_CACHE).then((cache) => cache.put(request, copy).then(() => trimCache(cache)));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // No cached fallback either — let the real network error
        // surface to the page, same as if this handler didn't exist.
        throw new Error("Network request failed and no cached response is available");
      })
  );
});

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== API_CACHE && key.startsWith("wl-api-cache-")).map((key) => caches.delete(key)))
      ),
    ])
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Malformed or non-JSON push payload — still show something rather
    // than silently dropping the notification.
  }

  const title = payload.title || "Weekend League";
  const options = {
    body: payload.body || "",
    icon: payload.icon || DEFAULT_ICON,
    badge: payload.badge || DEFAULT_ICON,
    data: payload.data || { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => {
        try {
          return new URL(client.url).pathname === new URL(url, self.location.origin).pathname;
        } catch {
          return false;
        }
      });
      if (existing) return existing.focus();

      const anyClient = clients[0];
      if (anyClient && "navigate" in anyClient) {
        return anyClient.navigate(url).then((client) => client && client.focus());
      }

      return self.clients.openWindow(url);
    })
  );
});
