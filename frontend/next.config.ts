import type { NextConfig } from "next";

// Next.js 16's dev server blocks serving JS (including HMR) to any
// origin other than localhost by default — without this, a phone on
// the same WiFi loads the initial server-rendered HTML fine but every
// client component (dropdowns, toggles, anything with an onClick/
// onChange) silently does nothing, since React never hydrates. Derived
// from NEXT_PUBLIC_API_BASE_URL (already the LAN IP once set up per
// DEVELOPMENT.md's "Testing on your phone") rather than hardcoding an
// IP here, so nothing network-specific lives in committed source.
function devOrigins(): string[] {
  const origins: string[] = [];

  // Base44 preview — the dev server is served through a proxy hostname
  // that changes whenever the environment is recreated, so allow the
  // derived origin explicitly (a bare '*' does not match in Next 16).
  const suffix = process.env.BASE44_PUBLIC_HOST_SUFFIX;
  if (suffix) origins.push(`3000-${suffix}`);

  // LAN testing — same derivation as before, from the API base URL.
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (apiBase) {
    try {
      const host = new URL(apiBase).hostname;
      if (host !== "localhost" && host !== "127.0.0.1") origins.push(host);
    } catch {
      // ignore
    }
  }

  return origins;
}

// Baseline security headers (2026-09 audit finding: none were set
// anywhere, frontend or backend — see backend/app/main.py's own
// security_headers middleware for the API-side counterpart). No
// Content-Security-Policy here either, same reasoning as that
// middleware's comment: this app pulls from several real external
// origins (ESPN/Sleeper image CDNs, Google Fonts, a WebSocket back to
// the Railway API) and a wrong CSP fails closed rather than erroring
// loudly — needs its own careful pass, not rushed days before a live
// draft. These are safe and can't break any existing functionality.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins(),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  images: {
    remotePatterns: [
      // Player headshots and NFL team logos (PlayerHeadshot.tsx) — ESPN's
      // own public CDN, no API key involved.
      { protocol: "https", hostname: "a.espncdn.com" },
      // Player card headshots (PlayerCardModal.tsx) — Sleeper's own
      // free, keyless headshot CDN, keyed by sleeper_player_id (see
      // backend/app/domain/player_card.py's SLEEPER_HEADSHOT_URL).
      { protocol: "https", hostname: "sleepercdn.com" },
      // Chat image attachments (MessageComposer.tsx / MessageBubble.tsx) —
      // the Vercel Blob store provisioned for this app; see app/config.py's
      // CHAT_IMAGE_HOST for the backend-side counterpart of this allowlist.
      { protocol: "https", hostname: "ls7srleyqyy06rjq.public.blob.vercel-storage.com" },
      // Chat GIF picker (MessageComposer.tsx's GifPicker) — GIPHY serves
      // media from several numbered CDN subdomains (media0-4.giphy.com,
      // i.giphy.com), same wildcard-by-suffix trust model as the
      // backend's own GIPHY_MEDIA_HOST_SUFFIX check (app/image_url.py).
      // Missing this entry is exactly why a sent GIF rendered as a
      // broken image inline (next/image rejects any src whose hostname
      // isn't in this allowlist before ever requesting it) while the
      // same URL opened fine directly in a new tab, bypassing next/
      // image entirely (2026-09).
      { protocol: "https", hostname: "*.giphy.com" },
    ],
  },
};

export default nextConfig;
