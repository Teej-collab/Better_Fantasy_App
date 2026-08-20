import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { listSeasons } from "@/lib/api";
import { AuthStatus } from "@/components/AuthStatus";
import { HideOnHome } from "@/components/HideOnHome";
import { PageShell } from "@/components/PageShell";
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
  title: "Better Fantasy App",
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

async function NavBar() {
  const { seasons } = await listSeasons();
  const latestSeason = seasons.length > 0 ? Math.max(...seasons) : null;

  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <nav className="safe-px mx-auto flex max-w-4xl items-center gap-3 py-3 text-sm">
        <a href="/" className="shrink-0 font-semibold">
          <span className="sm:hidden">BFA</span>
          <span className="hidden sm:inline">Better Fantasy App</span>
        </a>
        {/* Single-row horizontal scroller on narrow screens instead of
            wrapping to 2-3 lines — same overscroll-containment technique
            as CardDeck.tsx's player deck, so a swipe here can't leak into
            page-level scroll/navigation. Reverts to a normal wrapping row
            once there's room (sm:), since these 6 links plus the brand
            already fit on one line at that width. */}
        <div className="flex min-w-0 flex-1 touch-pan-x items-center gap-x-4 overflow-x-auto overscroll-x-contain [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
          <a
            href="/standings"
            className="shrink-0 text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
          >
            Standings
          </a>
          <a
            href="/league"
            className="shrink-0 text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
          >
            League
          </a>
          {latestSeason !== null && (
            <a
              href={`/seasons/${latestSeason}/weeks/1`}
              className="shrink-0 text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
            >
              Matchups
            </a>
          )}
          {latestSeason !== null && (
            <a
              href={`/seasons/${latestSeason}/awards`}
              className="shrink-0 text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
            >
              Awards
            </a>
          )}
          <a
            href="/rivalries"
            className="shrink-0 text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
          >
            Rivalries
          </a>
          <a
            href="/players"
            className="shrink-0 text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
          >
            Players
          </a>
          <a href="/rules" className="shrink-0 text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white">
            Rules
          </a>
          <a href="/chug" className="shrink-0 text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white">
            Chug
          </a>
          <a
            href="/weekend"
            className="shrink-0 text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
          >
            The Weekend
          </a>
        </div>
        <AuthStatus />
      </nav>
    </header>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <HideOnHome>
          <NavBar />
        </HideOnHome>
        <PageShell>{children}</PageShell>
      </body>
    </html>
  );
}
