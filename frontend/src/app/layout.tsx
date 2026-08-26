import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AudioWarmup } from "@/components/AudioWarmup";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

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
  themeColor: "#23212c",
};

// Deliberately minimal — just the true document shell. The actual app
// chrome (nav bar, persistent ticker, page column) lives in
// app/(app)/layout.tsx and app/(home)/layout.tsx; /weekend has its own
// even-more-minimal layout. Splitting it this way (route groups, not a
// single root layout with client-side pathname checks hiding pieces of
// itself) is what actually guarantees /weekend never receives — or even
// server-fetches the data behind — chrome it shouldn't have. See
// app/(app)/layout.tsx's comment for the full reasoning.
// Settings > Appearance (Neon Intensity, Animations, Accent Color) —
// mirrored into small non-httpOnly cookies the moment any setting
// changes (see AppearanceSection.tsx), applied here via a blocking
// inline script instead of reading them server-side in this layout:
// RootLayout wraps every route, so calling cookies() here would force
// the *entire* app into dynamic rendering — including pages with no
// per-visitor data at all (e.g. /auth/complete) that are static today.
// A synchronous script in <head>, before <body> paints, avoids that
// same "flash of wrong intensity/motion/color" with zero cost to
// static generation — the standard technique (same one theme-switchers
// use for dark mode). wl_accent sets --user-accent, which every
// .neon-panel without its own section color falls back to
// (globals.css) — a strict hex check before setProperty so a malformed
// or hand-edited cookie can't leave the property set to garbage.
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
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
      // APPEARANCE_SCRIPT below sets data-neon and (sometimes)
      // motion-reduced/--user-accent on this element before React
      // hydrates, on purpose (that's what avoids a flash of the wrong
      // intensity/motion/color) — React only knows about the
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
        {children}
        <ServiceWorkerRegistration />
        <AudioWarmup />
      </body>
    </html>
  );
}
