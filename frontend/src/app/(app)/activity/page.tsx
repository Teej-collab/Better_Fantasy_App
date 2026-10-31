import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CommishChanges } from "@/components/commissioner/CommishChanges";
import {
  awardsHrefFor,
  getActiveLeagueName,
  getLeagueActivity,
  getMe,
  listSeasons,
  listTeamsServer,
  safeLatestSeason,
} from "@/lib/api";
import { EliteTitle } from "@/components/elite/Elite";
import { EliteWire } from "@/components/elite/EliteWire";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "League Activity — The Weekend" };

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

  const { seasons } = await listSeasons(sessionCookie);
  const latestSeason = safeLatestSeason(seasons);

  const [{ items }, activeLeagueName, { teams }] = await Promise.all([
    latestSeason !== null
      ? getLeagueActivity(latestSeason, sessionCookie, 50)
      : Promise.resolve({ items: [] }),
    getActiveLeagueName(sessionCookie),
    // Who owns each team, to split a trade into who gets what.
    latestSeason !== null ? listTeamsServer(sessionCookie, latestSeason).catch(() => ({ teams: [] })) : Promise.resolve({ teams: [] }),
  ]);
  const ownerByTeam = Object.fromEntries(teams.map((t) => [t.team_id, t.owner_id]));

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="activity" awardsHref={awardsHrefFor(latestSeason)} activeLeagueName={activeLeagueName} />
      <EliteTitle
        kicker="Off the"
        title="Wire"
        subtitle="Trades, waiver claims, adds and drops — from whenever this feature shipped, not the beginning of the season."
      />

      {items.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No activity yet.</p>
      ) : (
        <EliteWire items={items} myOwnerId={me.owner_id} ownerByTeam={ownerByTeam} />
      )}
      <CommishChanges />
    </div>
  );
}
