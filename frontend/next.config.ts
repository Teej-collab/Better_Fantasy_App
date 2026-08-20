import type { NextConfig } from "next";

// Next.js 16's dev server blocks serving JS (including HMR) to any
// origin other than localhost by default — without this, a phone on
// the same WiFi loads the initial server-rendered HTML fine but every
// client component (dropdowns, toggles, anything with an onClick/
// onChange) silently does nothing, since React never hydrates. Derived
// from NEXT_PUBLIC_API_BASE_URL (already the LAN IP once set up per
// DEVELOPMENT.md's "Testing on your phone") rather than hardcoding an
// IP here, so nothing network-specific lives in committed source.
function lanDevOrigin(): string[] {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBase) return [];
  try {
    const host = new URL(apiBase).hostname;
    return host === "localhost" || host === "127.0.0.1" ? [] : [host];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  allowedDevOrigins: lanDevOrigin(),
};

export default nextConfig;
