import Link from "next/link";
import type { AwardLeaderboardCategory } from "@/lib/api";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

const RANK_MEDAL = ["🥇", "🥈", "🥉"];

/**
 * All-time award leaderboards — "who's won this the most" for every
 * yearly award the league offers (app/domain/awards_all_time.py),
 * companion to RecordBook.tsx's numeric all-time records right above it
 * on the same page. Every award type always gets its own card, even one
 * nobody's won yet (an empty-state line instead of a leaderboard) — the
 * point of this section is showing the complete set of awards the
 * league runs, not just the ones with history so far.
 */
export function AwardLeaderboards({ categories }: { categories: AwardLeaderboardCategory[] }) {
  if (categories.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          All-Time Awards
        </h2>
        <p className="mt-0.5 text-xs text-black/40 dark:text-white/40">
          Every yearly award the league hands out, and who&apos;s won it the most.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {categories.map((category) => (
          <div
            key={category.key}
            className="neon-panel flex flex-col gap-2 rounded-xl p-4"
            style={panelGlowStyle(SECTION_COLORS.awards)}
          >
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <span aria-hidden>{category.emoji}</span>
              {category.label}
            </h3>
            {category.winners.length === 0 ? (
              <p className="text-xs text-black/40 dark:text-white/40">Not yet awarded.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {category.winners.map((winner, i) => (
                  <li key={winner.owner_id} className="flex items-center gap-2 text-sm">
                    <span className="w-5 shrink-0 text-center" aria-hidden>
                      {RANK_MEDAL[i] ?? i + 1}
                    </span>
                    <Link href={`/owners/${winner.owner_id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      {winner.owner_name}
                    </Link>
                    <span className="shrink-0 tabular-nums text-black/70 dark:text-white/70">
                      {winner.wins}x
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
