import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { awardsHrefFor, getMe, listSeasons, safeLatestSeason } from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";
import { NAV_ACCENT } from "@/lib/navDestinations";
import { panelGlowStyle } from "@/lib/sectionColors";

export const metadata: Metadata = { title: "History — Weekend League" };

/**
 * A small hub, not a merged mega-page — Awards, Player Cards, and the
 * lifetime Chug leaderboard are different enough shapes (a season/
 * record-book list, a trading-card grid, a leaderboard table) that
 * cramming all three onto one scrolling page would read worse than
 * three clean destinations one tap away, especially on mobile. Each
 * card below links to its own existing, unchanged page — this page
 * fetches nothing beyond what it needs to build the Awards card's
 * (season-dependent) href.
 *
 * Replaces four individual League-sub-nav tabs (Player Cards, Awards,
 * All-Time, Chug) that used to sit alongside this one — 2026-09-02
 * simplification, ten League-sub-nav tabs down to six. All-Time isn't
 * its own card here since the Awards page already links into it via
 * its own SeasonTabs extra tab — reusing that existing entry point
 * rather than duplicating it.
 */
export default async function HistoryPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);
  if (!me) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }
  if (me.active_league_id === null) {
    return <NeedsLeagueCard />;
  }

  const { seasons } = await listSeasons();
  const latestSeason = safeLatestSeason(seasons);
  const awardsHref = awardsHrefFor(latestSeason);

  const tiles: { href: string; title: string; description: string }[] = [
    {
      href: awardsHref,
      title: "Awards",
      description: "Every season's champion and awards, plus the all-time record book and leaderboards",
    },
    {
      href: "/players",
      title: "Player Cards",
      description: "Every owner who's ever been in the league — career stats and a trading card per season",
    },
    {
      href: "/chug",
      title: "Chug",
      description: "The lifetime leaderboard — who's completed the most, who still owes",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <LeagueSubNav active="history" awardsHref={awardsHref} />
      <div>
        <h1 className="text-2xl font-semibold">History</h1>
        <p className="text-sm text-black/60 dark:text-white/60">The league&apos;s past — awards, trading cards, and Chug.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="neon-panel flex flex-col gap-1 rounded-xl bg-black/[0.015] p-4 transition-all hover:bg-black/5 active:scale-[0.98] active:bg-black/10 dark:bg-white/[0.03] dark:hover:bg-white/5 dark:active:bg-white/10"
            style={panelGlowStyle(NAV_ACCENT)}
          >
            <span className="flex items-center gap-1.5 font-medium">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: NAV_ACCENT, boxShadow: `0 0 5px ${NAV_ACCENT}` }}
                aria-hidden
              />
              {tile.title}
            </span>
            <span className="text-sm text-black/50 dark:text-white/50">{tile.description}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
