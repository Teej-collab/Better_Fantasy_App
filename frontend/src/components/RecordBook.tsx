import type { RecordCategory, RecordEntry } from "@/lib/api";
import { AWARD_DESCRIPTIONS } from "@/lib/awardDescriptions";
import { RankedCategoryCard } from "@/components/RankedCategoryCard";
import { SECTION_COLORS } from "@/lib/sectionColors";

function formatValue(entry: RecordEntry, unit: string): string {
  return `${entry.value.toFixed(1)} ${unit}`;
}

function contextLine(entry: RecordEntry): string {
  if (entry.opponent_team_name) {
    // Biggest Blowout — own_score is only ever present on this category.
    const ownScore = entry.own_score !== undefined ? entry.own_score.toFixed(1) : null;
    return ownScore
      ? `${ownScore} – ${entry.opponent_score?.toFixed(1)} vs ${entry.opponent_team_name} · Season ${entry.season}${entry.week ? `, Wk ${entry.week}` : ""}`
      : `vs ${entry.opponent_team_name} · Season ${entry.season}`;
  }
  return entry.week ? `Season ${entry.season}, Week ${entry.week}` : `Season ${entry.season}`;
}

/**
 * All-time record book — one card per category (app/domain/records.py),
 * each a top-3 leaderboard. Lives on its own "All-Time Records" tab
 * under Awards (seasons/[season]/awards/all-time/page.tsx), a pinned tab
 * in SeasonTabs.tsx alongside every season's own tab — unlike a specific
 * season's awards, this is never season-scoped: same content no matter
 * which season you were last looking at, since these span the league's
 * whole history. Fetched fresh on every page load (no caching anywhere
 * in the chain), so a newly-broken record shows up the moment it's
 * synced — nothing here needs a manual refresh or recompute step.
 *
 * Card rendering delegates to the shared <RankedCategoryCard> —
 * Documentation/UX/00_UX_Audit.md found this component, AwardLeaderboards,
 * and PowerRankingsAllTime independently reimplementing the same card
 * shape; see that shared component's own docstring.
 */
export function RecordBook({ categories, beta = false }: { categories: RecordCategory[]; beta?: boolean }) {
  const withEntries = categories.filter((c) => c.entries.length > 0);
  if (withEntries.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          All-Time Records
        </h2>
        <p className="mt-0.5 text-xs text-black/50 dark:text-white/50">
          The league&apos;s history, updated the moment a record is broken.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {withEntries.map((category) => (
          <RankedCategoryCard
            key={category.key}
            emoji={category.emoji}
            label={category.label}
            description={AWARD_DESCRIPTIONS[category.key]}
            sectionColor={SECTION_COLORS.awards}
            beta={beta}
            entries={category.entries.map((entry) => ({
              key: `${entry.owner_id}-${entry.season}-${entry.week ?? "season"}`,
              rank: 0,
              name: entry.owner_name,
              value: formatValue(entry, category.unit),
              context: `${entry.team_name} · ${contextLine(entry)}`,
            }))}
          />
        ))}
      </div>
    </section>
  );
}
