import { getCareerProfile, getOwnerBadges, listOwners, listSeasons } from "@/lib/api";
import { CardDeck } from "@/components/CardDeck";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";

export default async function PlayersPage() {
  const [{ owners }, { seasons }] = await Promise.all([listOwners(), listSeasons()]);

  const cards = await Promise.all(
    owners.map(async (owner) => {
      const [career, badges] = await Promise.all([
        getCareerProfile(owner.owner_id),
        getOwnerBadges(owner.owner_id),
      ]);
      return { owner, career, badges };
    })
  );

  const latestSeason = Math.max(...seasons);

  return (
    <div className="flex flex-col gap-6">
      <LeagueSubNav active="playerCards" awardsHref={`/seasons/${latestSeason}/awards`} />
      <div>
        <h1 className="text-2xl font-semibold">Player Cards</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Every owner who&apos;s ever been in the league — {owners.length} total. Pick a season
          on any card for that year&apos;s stats.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {[...seasons].reverse().map((season) => (
          <a
            key={season}
            href={`/standings?season=${season}`}
            className="rounded-full border border-black/10 px-3 py-1.5 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
          >
            {season}
          </a>
        ))}
      </div>

      <CardDeck
        cards={cards.filter(
          (c): c is typeof c & { career: NonNullable<typeof c.career> } => c.career !== null
        )}
      />
    </div>
  );
}
