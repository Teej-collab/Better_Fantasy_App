// Weekend League's service worker — scope is deliberately narrow:
// receive a push, show a notification, and route a tap to the right
// page. No fetch interception, no offline cache, no app-runtime logic
// here; those are separate concerns for later if they're ever needed,
// not bundled into the same file by default. See docs on adding new
// push notification types before extending this file.
//
// skipWaiting()/clients.claim() below mean a newly deployed version of
// this file takes over immediately (next load, no waiting for every
// open tab to close first) — without them, a visitor could stay stuck
// on a stale service worker indefinitely.

const DEFAULT_ICON = "/images/icon-192.png";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
