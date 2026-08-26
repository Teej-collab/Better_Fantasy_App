import type { PowerRankingsAllTimeCategory } from "@/lib/api";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

const RANK_MEDAL = ["🥇", "🥈", "🥉"];

/**
 * All-time Power Rankings / Luck Index / Strength of Schedule
 * leaderboards (app/domain/power_rankings.py's get_all_time_indices) —
 * same card-grid shape as RecordBook.tsx, computed live on every
 * request rather than stored, so it always reflects the latest sync.
 * Entries are career averages across every week an owner has ever had
 * a weekly_team_stats row, not tied to a single game/season the way
 * RecordBook's entries are — no team name/week/season per entry here,
 * just the owner and their number.
 */
export function PowerRankingsAllTime({ categories }: { categories: PowerRankingsAllTimeCategory[] }) {
  const withEntries = categories.filter((c) => c.entries.length > 0);
  if (withEntries.length === 0) {
    return <p className="text-sm text-black/50 dark:text-white/50">Not enough history yet.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {withEntries.map((category) => (
        <div
          key={category.key}
          className="neon-panel flex flex-col gap-2 rounded-xl p-4"
          style={panelGlowStyle(SECTION_COLORS.powerRankings)}
        >
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <span aria-hidden>{category.emoji}</span>
            {category.label}
          </h3>
          <ol className="flex flex-col gap-2">
            {category.entries.map((entry, i) => (
              <li key={entry.owner_id} className="flex items-center gap-2 text-sm">
                <span className="w-5 shrink-0 text-center" aria-hidden>
                  {RANK_MEDAL[i] ?? i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{entry.owner_name}</span>
                <span className="shrink-0 tabular-nums text-black/70 dark:text-white/70">
                  {entry.value.toFixed(entry.value % 1 === 0 ? 0 : 1)} {category.unit}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
