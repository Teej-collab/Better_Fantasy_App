import type { RecordCategory, RecordEntry } from "@/lib/api";
import { AWARD_DESCRIPTIONS } from "@/lib/awardDescriptions";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

const RANK_MEDAL = ["🥇", "🥈", "🥉"];

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
 */
export function RecordBook({ categories }: { categories: RecordCategory[] }) {
  const withEntries = categories.filter((c) => c.entries.length > 0);
  if (withEntries.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          All-Time Records
        </h2>
        <p className="mt-0.5 text-xs text-black/40 dark:text-white/40">
          The league&apos;s history, updated the moment a record is broken.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {withEntries.map((category) => (
          <div
            key={category.key}
            className="neon-panel flex flex-col gap-2 rounded-xl p-4"
            style={panelGlowStyle(SECTION_COLORS.awards)}
          >
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <span aria-hidden>{category.emoji}</span>
                {category.label}
              </h3>
              {AWARD_DESCRIPTIONS[category.key] && (
                <p className="text-xs text-black/45 dark:text-white/45">{AWARD_DESCRIPTIONS[category.key]}</p>
              )}
            </div>
            <ol className="flex flex-col gap-2">
              {category.entries.map((entry, i) => (
                <li key={`${entry.owner_id}-${entry.season}-${entry.week ?? "season"}`} className="flex items-start gap-2 text-sm">
                  <span className="w-5 shrink-0 text-center" aria-hidden>
                    {RANK_MEDAL[i] ?? i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="break-words font-medium">{entry.owner_name}</span>
                      <span className="shrink-0 tabular-nums text-black/70 dark:text-white/70">
                        {formatValue(entry, category.unit)}
                      </span>
                    </div>
                    <p className="break-words text-xs text-black/50 dark:text-white/50">
                      {entry.team_name} · {contextLine(entry)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
