import type { CapacitorConfig } from "@capacitor/cli";

// This is a full Next.js SSR app — real server-side session cookies,
// WebSocket connections for the draft room/chat/Gamecast — with no
// static export configured. A locally bundled WebView copy would break
// auth and every live feature, so `server.url` points the native shell
// at the live production deployment instead: the WebView just loads
// the real site, the same way Safari/Chrome on the phone already does
// via the PWA. `webDir` is required by the CLI but unused at runtime
// once `server.url` is set — pointed at `public` since that's the
// closest thing this repo has to a static asset root.
const config: CapacitorConfig = {
  appId: "com.weekendleague.app",
  appName: "Weekend League",
  // A real web asset dir is required by the native project generators
  // even though it's never shown (server.url below takes over at
  // runtime) — kept separate from the real Next.js public/ dir so this
  // placeholder can't collide with anything served on the live site.
  webDir: "capacitor-www",
  server: {
    url: "https://weekend-league-web.vercel.app",
    cleartext: false,
  },
  // Matches manifest.json's theme_color/background_color — same Cosmic
  // dark background behind the native splash screen and status bar
  // instead of the Capacitor default white flash before the WebView
  // loads.
  backgroundColor: "#23212c",
};

export default config;
