import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { listSeasons } from "@/lib/api";
import { AuthStatus } from "@/components/AuthStatus";
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

async function NavBar() {
  const { seasons } = await listSeasons();
  const latestSeason = seasons.length > 0 ? Math.max(...seasons) : null;

  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <nav className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
        <a href="/" className="font-semibold">
          <span className="sm:hidden">BFA</span>
          <span className="hidden sm:inline">Better Fantasy App</span>
        </a>
        <a href="/standings" className="text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white">
          Standings
        </a>
        <a href="/league" className="text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white">
          League
        </a>
        {latestSeason !== null && (
          <a
            href={`/seasons/${latestSeason}/weeks/1`}
            className="text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
          >
            Matchups
          </a>
        )}
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
        <NavBar />
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
