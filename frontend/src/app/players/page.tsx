import { getCareerProfile, getOwnerBadges, listOwners, listSeasons } from "@/lib/api";
import { TeamProfileCard } from "@/components/TeamProfileCard";

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

  return (
    <div className="flex flex-col gap-6">
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

      {/* Horizontal deck, not a grid — snap-scroll so each swipe/scroll
          settles on one card at a time, like flipping through a stack,
          rather than a vertically-scrolling list. -mx-4/px-4 lets it
          bleed to the screen edges (undoing PageShell's page padding)
          so the next card peeks in from the right as a scroll hint. */}
      <div
        className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {cards
          .filter((c): c is typeof c & { career: NonNullable<typeof c.career> } => c.career !== null)
          .map(({ owner, career, badges }) => (
            <div key={owner.owner_id} className="w-[85vw] shrink-0 snap-center sm:w-[420px]">
              <TeamProfileCard owner={owner} initialCareer={career} initialBadges={badges} />
            </div>
          ))}
      </div>
    </div>
  );
}
