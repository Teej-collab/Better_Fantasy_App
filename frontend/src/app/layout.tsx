import type { Metadata, Viewport } from "next";
import { Geist_Mono, IBM_Plex_Sans, Oswald } from "next/font/google";
import "./globals.css";
import { AudioWarmup } from "@/components/AudioWarmup";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PageViewTracker } from "@/components/PageViewTracker";
import { PresenceProvider } from "@/components/PresenceProvider";
import { PlayerCardProvider } from "@/components/players/PlayerCardProvider";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

// Body text — replaced Geist Sans 2026-08-31 as part of the redesign
// into the calmer "Weekend League Walkthrough" mock the owner approved:
// a real, deliberately-chosen typeface pairing instead of the generic
// default. --font-body feeds globals.css's --font-sans theme token,
// which is what body's own font-family rule actually reads.
const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Display face — nav wordmark, page headings, big score/rank numerals.
// A condensed, uppercase-leaning face on purpose: it's what gives the
// calmer redesign's headings a "broadcast graphics" identity instead of
// reading as the same body text just bolded. See globals.css's
// --font-display theme token and the .font-display utility it
// generates.
const oswald = Oswald({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Kept from before — still used for the handful of tabular-number
// score displays that reach for `font-mono` (MatchupCard.tsx and
// friends); unrelated to the body/display swap above.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Weekend League",
  description: "League standings, matchups, and rosters.",
  manifest: "/manifest.json",
  // Lets iOS treat a Home Screen install as a standalone app (own
  // window, no Safari chrome) instead of just a bookmark — required
  // for push notifications to work at all on iPhone/iPad, which only
  // deliver web push to an installed PWA, never to Safari itself.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Weekend League",
  },
};

// viewportFit: "cover" lets the page draw under the notch/dynamic
// island/home-indicator on iPhone instead of leaving a plain bar there
// — the .safe-px class (globals.css) then keeps actual content clear
// of that area. themeColor matches the browser chrome (status bar /
// URL bar) to the page background — a single value, not one per color
// scheme, since the app is always the Cosmic dark theme regardless of
// the visitor's OS setting (see globals.css's theme note and the
// `dark` class below).
//
// interactiveWidget: "resizes-content" tells the browser to actually
// shrink the layout viewport (not just the visual viewport) when the
// on-screen keyboard opens. Without it, every 100dvh-based height —
// ChatApp.tsx's message pane, BottomNav's `fixed bottom-0` — keeps
// sizing against the pre-keyboard viewport, so the composer (and the
// bottom nav below it) gets pushed down behind the keyboard and out of
// reach instead of the page reflowing above it, on Android Chrome and
// iOS Safari 17.4+.
export const viewport: Viewport = {
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#0d1016",
};

// Deliberately minimal — just the true document shell. The actual app
// chrome (nav bar, persistent ticker, page column) lives in
// app/(app)/layout.tsx and app/(home)/layout.tsx; /weekend has its own
// even-more-minimal layout. Splitting it this way (route groups, not a
// single root layout with client-side pathname checks hiding pieces of
// itself) is what actually guarantees /weekend never receives — or even
// server-fetches the data behind — chrome it shouldn't have. See
// app/(app)/layout.tsx's comment for the full reasoning.
// Settings > Appearance (Neon Intensity, Animations, Accent Color,
// Look) — mirrored into small non-httpOnly cookies the moment any
// setting changes (see AppearanceSection.tsx), applied here via a
// blocking inline script instead of reading them server-side in this
// layout:
// RootLayout wraps every route, so calling cookies() here would force
// the *entire* app into dynamic rendering — including pages with no
// per-visitor data at all (e.g. /auth/complete) that are static today.
// A synchronous script in <head>, before <body> paints, avoids that
// same "flash of wrong intensity/motion/color" with zero cost to
// static generation — the standard technique (same one theme-switchers
// use for dark mode). wl_accent sets --user-accent, which every
// .neon-panel without its own section color falls back to
// (globals.css); wl_your_week_color/wl_border_color set two more,
// narrower personal colors (--your-week-color: just the Home page's
// Your Week card; --border-glow-color: the moving ring on every card)
// that themselves fall back to --user-accent when unset — a strict hex
// check before every setProperty so a malformed or hand-edited cookie
// can't leave a property set to garbage.
const APPEARANCE_SCRIPT = `
(function () {
  try {
    var m = document.cookie.match(/(?:^|; )wl_neon=([^;]+)/);
    document.documentElement.setAttribute("data-neon", m ? m[1] : "standard");
    if (/(?:^|; )wl_motion=reduced(?:;|$)/.test(document.cookie)) {
      document.documentElement.classList.add("motion-reduced");
    }
    var a = document.cookie.match(/(?:^|; )wl_accent=([^;]+)/);
    if (a && /^#[0-9a-fA-F]{6}$/.test(a[1])) {
      document.documentElement.style.setProperty("--user-accent", a[1]);
    }
    var yw = document.cookie.match(/(?:^|; )wl_your_week_color=([^;]+)/);
    if (yw && /^#[0-9a-fA-F]{6}$/.test(yw[1])) {
      document.documentElement.style.setProperty("--your-week-color", yw[1]);
    }
    var bg = document.cookie.match(/(?:^|; )wl_border_color=([^;]+)/);
    if (bg && /^#[0-9a-fA-F]{6}$/.test(bg[1])) {
      document.documentElement.style.setProperty("--border-glow-color", bg[1]);
    }
    var t = document.cookie.match(/(?:^|; )wl_theme=([^;]+)/);
    document.documentElement.setAttribute("data-wl-theme", t && t[1] === "cosmic" ? "cosmic" : "calm");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${ibmPlexSans.variable} ${oswald.variable} ${geistMono.variable} h-full antialiased dark`}
      // APPEARANCE_SCRIPT below sets data-neon, data-wl-theme, and
      // (sometimes) motion-reduced/--user-accent on this element before
      // React hydrates, on purpose (that's what avoids a flash of the
      // wrong intensity/motion/color/look) — React only knows about the
      // server-rendered version without those, and would otherwise log
      // a hydration mismatch for a difference this element is supposed
      // to have. Standard suppressHydrationWarning use case: it only
      // silences the warning on this one element, not any real
      // mismatch in its children.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        {/* Site-wide, opacity-gated by [data-wl-theme="cosmic"]
            (globals.css) — invisible (opacity 0) in the default "calm"
            look, so this costs nothing for every visitor who hasn't
            opted into Cosmic in Settings > Appearance. Fixed/negative
            z-index/pointer-events:none, same restrained pattern as
            .home-ambient (the homepage's own decorative wash) — never
            affects layout, just what's painted behind it. */}
        <div className="cosmic-ambient" aria-hidden />
        <OfflineBanner />
        <PageViewTracker />
        <PresenceProvider>
          <PlayerCardProvider>{children}</PlayerCardProvider>
        </PresenceProvider>
        <ServiceWorkerRegistration />
        <AudioWarmup />
      </body>
    </html>
  );
}
