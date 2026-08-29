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

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins(),
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
    ],
  },
};

export default nextConfig;
