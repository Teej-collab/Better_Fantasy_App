import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getMe } from "@/lib/api";
import { SignInCard } from "@/components/SignInCard";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { NAV_ACCENT } from "@/lib/navDestinations";

export const metadata: Metadata = { title: "More — Weekend League" };

/**
 * The beta nav's catch-all tab (Documentation/UX/02_Information_
 * Architecture.md) — houses everything that moved out of a dedicated
 * top-level slot to make room for Chat: My Team's own sub-nav
 * destinations (Roster, Draft, Keepers, Free Agents, Trades), Gamecast,
 * Settings, and (commissioners only) League Management. Only reachable
 * when BottomNavBeta/PrimaryNavBeta render (Settings > Labs > "Try the
 * new look") — the legacy nav still gives each of these its own
 * dedicated slot or sub-nav, unchanged.
 *
 * Flat cards (.wl-card, Documentation/UX/01_Design_System.md section
 * 4) rather than .neon-panel's rotating glow ring — this hub is a
 * static site map, nothing on it is live, so nothing on it glows.
 */
export default async function MorePage() {
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

  const myTeamTiles = [
    { href: "/team", title: "My Team", description: "Your roster — starters, bench, and lineup" },
    { href: "/draft", title: "Draft", description: "Live draft room, board, and grades" },
    { href: "/keepers", title: "Keepers", description: "This season's keeper picks and rules" },
    { href: "/free-agents", title: "Free Agents", description: "Add or drop a player" },
    { href: "/trades", title: "Trades", description: "Propose, review, and track trades" },
  ];

  const otherTiles = [
    { href: "/gamecast", title: "Gamecast", description: "Live NFL scores, drives, and play-by-play" },
    { href: "/settings", title: "Settings", description: "Profile, appearance, and notifications" },
    ...(me.is_commissioner
      ? [{ href: "/commissioner", title: "League Management", description: "Commissioner tools" }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">More</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Your team, the draft, and everything else.</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">My Team</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {myTeamTiles.map((tile) => (
            <MoreTile key={tile.href} {...tile} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">More</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {otherTiles.map((tile) => (
            <MoreTile key={tile.href} {...tile} />
          ))}
        </div>
      </section>
    </div>
  );
}

function MoreTile({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="wl-card flex flex-col gap-1 rounded-xl p-4 transition-colors hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10"
    >
      <span className="flex items-center gap-1.5 font-medium">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: NAV_ACCENT }}
          aria-hidden
        />
        {title}
      </span>
      <span className="text-sm text-black/50 dark:text-white/50">{description}</span>
    </Link>
  );
}
