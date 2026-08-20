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
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
