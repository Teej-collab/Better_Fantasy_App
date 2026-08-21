import { listSeasons } from "@/lib/api";
import { AuthStatus } from "@/components/AuthStatus";
import { ChatNavBadge } from "@/components/ChatNavBadge";

/**
 * Shared by app/(app)/layout.tsx and app/(home)/layout.tsx — every
 * route except /weekend, which lives outside both groups specifically
 * so it never receives this chrome at all (not even server-rendered —
 * see those layouts' own comments for why that distinction matters).
 */
export async function NavBar() {
  const { seasons } = await listSeasons();
  const latestSeason = seasons.length > 0 ? Math.max(...seasons) : null;

  return (
    <header id="site-nav" className="border-b border-black/10 dark:border-white/10">
      <nav className="safe-px mx-auto flex max-w-4xl items-center gap-3 py-3 text-sm">
        <a href="/" className="shrink-0 font-semibold">
          <span className="sm:hidden">WL</span>
          <span className="hidden sm:inline">Weekend League</span>
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
            href="/team"
            className="shrink-0 text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
          >
            My Team
          </a>
          <a
            href="/free-agents"
            className="shrink-0 text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
          >
            Free Agents
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
          <ChatNavBadge />
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
