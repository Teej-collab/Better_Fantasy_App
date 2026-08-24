"use client";

// Client-side half of the Web Push flow — service worker readiness,
// browser permission, PushManager subscription, and talking to the
// backend's /push/* routes (app/routers/push.py). Every network call
// here goes through /api/backend/... (the same-origin catch-all proxy
// every other authenticated client-side call in this app uses — see
// getChatMembers()/getPreferences() in this same file) rather than
// hitting the backend host directly, so Safari's ITP cross-site-cookie
// blocking never becomes a problem here either.

function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// iOS/iPadOS only ever deliver web push to a site installed to the
// Home Screen — Safari itself (even a pinned tab) never receives push,
// regardless of permission state. window.navigator.standalone is
// Safari's own (non-standard, iOS-only) way of reporting "running as
// an installed PWA right now"; the display-mode media query is the
// cross-browser equivalent, checked as a fallback for non-Safari iOS
// browsers (which also run on WebKit and share this same restriction).
export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isInstalledStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  if (!isPushSupported()) throw new Error("Push notifications aren't supported in this browser");
  return navigator.serviceWorker.ready;
}

async function getVapidPublicKey(): Promise<string> {
  const res = await fetch("/api/backend/push/vapid-public-key");
  if (!res.ok) throw new Error("Push notifications aren't configured on the server yet");
  const { public_key } = await res.json();
  return public_key;
}

function deviceLabel(): string {
  if (typeof navigator === "undefined") return "Unknown device";
  const ua = navigator.userAgent;
  const platform = /iphone|ipad/i.test(ua) ? "iPhone/iPad" : /android/i.test(ua) ? "Android" : /mac/i.test(ua) ? "Mac" : /win/i.test(ua) ? "Windows" : "Device";
  const browser = /crios/i.test(ua) ? "Chrome" : /fxios|firefox/i.test(ua) ? "Firefox" : /edg/i.test(ua) ? "Edge" : /chrome/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "Browser";
  return `${browser} on ${platform}`;
}

// Requests browser permission (only ever called after the user has
// already chosen to enable notifications in our own UI — see
// NotificationsSection.tsx's priming screen, never on page load),
// subscribes via PushManager, and registers the subscription with the
// backend. Throws with a message safe to show the user directly on any
// failure (permission denied, unsupported browser, server not
// configured) — callers should catch and display err.message as-is.
export async function subscribeToPush(): Promise<void> {
  if (!isPushSupported()) {
    throw new Error("Push notifications aren't available in this browser.");
  }
  if (isIosDevice() && !isInstalledStandalone()) {
    throw new Error("Add Weekend League to your Home Screen first — iPhone/iPad only deliver notifications to an installed app.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this site — enable them in your browser settings to turn this on."
        : "Notification permission wasn't granted."
    );
  }

  const registration = await getRegistration();
  const publicKey = await getVapidPublicKey();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = subscription.toJSON();
  const res = await fetch("/api/backend/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      device_label: deviceLabel(),
    }),
  });
  if (!res.ok) {
    // Don't leave the browser subscribed to something the backend
    // never recorded — a silent mismatch is worse than no subscription.
    await subscription.unsubscribe().catch(() => {});
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? "Couldn't save your subscription — try again.");
  }
}

// Unsubscribes THIS device only — every other device the owner has
// enabled stays untouched, both in the browser (they're separate
// PushSubscription objects) and on the backend (push/unsubscribe is
// scoped to one endpoint).
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await getRegistration();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  await fetch("/api/backend/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {});
  await subscription.unsubscribe();
}

// True if THIS browser currently holds a live PushSubscription — the
// per-device signal NotificationsSection.tsx shows ("Notifications
// enabled on this device"), independent of the account-wide
// push_enabled preference (which just means "at least one device,
// somewhere, is subscribed").
export async function isSubscribedOnThisDevice(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return false;
  }
}

export async function sendTestNotification(): Promise<{ delivered: number; attempted: number }> {
  const res = await fetch("/api/backend/push/test", { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? "Couldn't send a test notification.");
  }
  return res.json();
}
