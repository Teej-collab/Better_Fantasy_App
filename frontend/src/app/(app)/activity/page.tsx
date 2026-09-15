import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  awardsHrefFor,
  getActiveLeagueName,
  getLeagueActivity,
  getMe,
  listSeasons,
  safeLatestSeason,
} from "@/lib/api";
import { LeagueActivityFeed } from "@/components/LeagueActivityFeed";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "League Activity — Weekend League" };

export default async function ActivityPage() {
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

  const [{ items }, activeLeagueName] = await Promise.all([
    latestSeason !== null
      ? getLeagueActivity(latestSeason, sessionCookie, 50)
      : Promise.resolve({ items: [] }),
    getActiveLeagueName(sessionCookie),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="activity" awardsHref={awardsHrefFor(latestSeason)} activeLeagueName={activeLeagueName} />
      <h1 className="text-2xl font-semibold">League Activity</h1>
      <p className="text-xs text-black/50 dark:text-white/50">
        Trades, waiver pickups, and free-agent adds/drops — starts from whenever this feature shipped, not the
        beginning of the season.
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No activity yet.</p>
      ) : (
        <LeagueActivityFeed items={items} />
      )}
    </div>
  );
}
