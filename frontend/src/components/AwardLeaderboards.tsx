import type { AwardLeaderboardCategory } from "@/lib/api";
import { AWARD_DESCRIPTIONS } from "@/lib/awardDescriptions";
import { RankedCategoryCard } from "@/components/RankedCategoryCard";
import { SECTION_COLORS } from "@/lib/sectionColors";

/**
 * All-time award leaderboards — "who's won this the most" for every
 * yearly award the league offers (app/domain/awards_all_time.py),
 * companion to RecordBook.tsx's numeric all-time records right above it
 * on the same page. Every award type always gets its own card, even one
 * nobody's won yet (an empty-state line instead of a leaderboard) — the
 * point of this section is showing the complete set of awards the
 * league runs, not just the ones with history so far.
 *
 * Card rendering delegates to the shared <RankedCategoryCard> — see
 * that component's own docstring for why.
 */
export function AwardLeaderboards({ categories, beta = false }: { categories: AwardLeaderboardCategory[]; beta?: boolean }) {
  if (categories.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          All-Time Awards
        </h2>
        <p className="mt-0.5 text-xs text-black/50 dark:text-white/50">
          Every yearly award the league hands out, and who&apos;s won it the most.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {categories.map((category) => (
          <RankedCategoryCard
            key={category.key}
            emoji={category.emoji}
            label={category.label}
            description={AWARD_DESCRIPTIONS[category.key]}
            sectionColor={SECTION_COLORS.awards}
            beta={beta}
            emptyMessage="Not yet awarded."
            entries={category.winners.map((winner) => ({
              key: String(winner.owner_id),
              rank: 0,
              name: winner.owner_name,
              nameHref: `/owners/${winner.owner_id}`,
              value: `${winner.wins}x`,
            }))}
          />
        ))}
      </div>
    </section>
  );
}
