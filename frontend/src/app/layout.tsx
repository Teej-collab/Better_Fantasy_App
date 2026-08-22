import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
};

// viewportFit: "cover" lets the page draw under the notch/dynamic
// island/home-indicator on iPhone instead of leaving a plain white or
// black bar there — the .safe-px class (globals.css) then keeps actual
// content clear of that area. themeColor matches the browser chrome
// (status bar / URL bar) to the page background per color scheme, so
// the app reads as a real app rather than a page floating in a
// mismatched browser frame on a phone home screen.
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

// Deliberately minimal — just the true document shell. The actual app
// chrome (nav bar, persistent ticker, page column) lives in
// app/(app)/layout.tsx and app/(home)/layout.tsx; /weekend has its own
// even-more-minimal layout. Splitting it this way (route groups, not a
// single root layout with client-side pathname checks hiding pieces of
// itself) is what actually guarantees /weekend never receives — or even
// server-fetches the data behind — chrome it shouldn't have. See
// app/(app)/layout.tsx's comment for the full reasoning.
// Settings > Appearance (Neon Intensity, Animations) — mirrored into
// small non-httpOnly cookies the moment either setting changes (see
// AppearanceSection.tsx), applied here via a blocking inline script
// instead of reading them server-side in this layout: RootLayout wraps
// every route, so calling cookies() here would force the *entire* app
// into dynamic rendering — including pages with no per-visitor data at
// all (e.g. /auth/complete) that are static today. A synchronous
// script in <head>, before <body> paints, avoids that same "flash of
// wrong intensity/motion" with zero cost to static generation — the
// standard technique (same one theme-switchers use for dark mode).
const APPEARANCE_SCRIPT = `
(function () {
  try {
    var m = document.cookie.match(/(?:^|; )wl_neon=([^;]+)/);
    document.documentElement.setAttribute("data-neon", m ? m[1] : "standard");
    if (/(?:^|; )wl_motion=reduced(?:;|$)/.test(document.cookie)) {
      document.documentElement.classList.add("motion-reduced");
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
