import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  awardsHrefFor,
  getCareerProfile,
  getMe,
  getOwnerBadges,
  listOwners,
  listSeasons,
  safeLatestSeason,
} from "@/lib/api";
import { CardDeck } from "@/components/CardDeck";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SeasonTabs } from "@/components/nav/SeasonTabs";
import { SignInCard } from "@/components/SignInCard";

export const metadata: Metadata = { title: "Player Cards — Weekend League" };

export default async function PlayersPage() {
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

  const [{ owners }, { seasons }] = await Promise.all([listOwners(sessionCookie), listSeasons()]);

  const cards = await Promise.all(
    owners.map(async (owner) => {
      const [career, badges] = await Promise.all([
        getCareerProfile(owner.owner_id, sessionCookie),
        getOwnerBadges(owner.owner_id, sessionCookie),
      ]);
      return { owner, career, badges };
    })
  );

  const latestSeason = safeLatestSeason(seasons);

  return (
    <div className="flex flex-col gap-6">
      <LeagueSubNav active="playerCards" awardsHref={awardsHrefFor(latestSeason)} />
      <div>
        <h1 className="text-2xl font-semibold">Player Cards</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Every owner who&apos;s ever been in the league — {owners.length} total. Pick a season
          on any card for that year&apos;s stats.
        </p>
      </div>

      <SeasonTabs seasons={seasons} activeSeason={null} hrefFor={(s) => `/standings?season=${s}`} />

      <CardDeck
        cards={cards.filter(
          (c): c is typeof c & { career: NonNullable<typeof c.career> } => c.career !== null
        )}
      />
    </div>
  );
}
