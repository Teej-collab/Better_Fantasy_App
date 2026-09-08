import type { PowerRankingsAllTimeCategory } from "@/lib/api";
import { RankedCategoryCard } from "@/components/RankedCategoryCard";
import { SECTION_COLORS } from "@/lib/sectionColors";

/**
 * All-time Power Rankings / Luck Index / Strength of Schedule
 * leaderboards (app/domain/power_rankings.py's get_all_time_indices) —
 * same card shape as RecordBook.tsx, computed live on every request
 * rather than stored, so it always reflects the latest sync. Entries
 * are career averages across every week an owner has ever had a
 * weekly_team_stats row, not tied to a single game/season the way
 * RecordBook's entries are — no team name/week/season per entry here,
 * just the owner and their number.
 *
 * Card rendering delegates to the shared <RankedCategoryCard> — see
 * that component's own docstring for why.
 */
export function PowerRankingsAllTime({
  categories,
  beta = false,
}: {
  categories: PowerRankingsAllTimeCategory[];
  beta?: boolean;
}) {
  const withEntries = categories.filter((c) => c.entries.length > 0);
  if (withEntries.length === 0) {
    return <p className="text-sm text-black/50 dark:text-white/50">Not enough history yet.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {withEntries.map((category) => (
        <RankedCategoryCard
          key={category.key}
          emoji={category.emoji}
          label={category.label}
          sectionColor={SECTION_COLORS.powerRankings}
          beta={beta}
          entries={category.entries.map((entry) => ({
            key: String(entry.owner_id),
            rank: 0,
            name: entry.owner_name,
            value: `${entry.value.toFixed(entry.value % 1 === 0 ? 0 : 1)} ${category.unit}`,
          }))}
        />
      ))}
    </div>
  );
}
