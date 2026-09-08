import Link from "next/link";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

const RANK_MEDAL = ["🥇", "🥈", "🥉"];

export type RankedCategoryEntry = {
  key: string;
  rank: number;
  name: string;
  nameHref?: string;
  value: string;
  context?: string;
};

/**
 * The shared "medal + ranked list" card — Documentation/UX/
 * 00_UX_Audit.md's single highest-leverage consolidation finding:
 * RecordBook.tsx, AwardLeaderboards.tsx, and PowerRankingsAllTime.tsx
 * each independently reimplemented this identical card shape (medal,
 * label+emoji, description, ranked entries) with slightly different
 * entry data, to the point a reader couldn't visually tell "this is a
 * numeric record" from "this is a yearly trophy" from "this is an
 * all-time power-rank leaderboard." One component now, parameterized
 * by category — see Documentation/UX/03_Component_System.md's
 * <RankedCategoryCard> spec. Each of those three files still owns its
 * own domain-specific formatting (contextLine, wins-count, etc.); this
 * only owns the shared visual shape.
 *
 * Flat (.wl-card) under Settings > Labs > "Try the new look" instead
 * of .neon-panel's rotating glow ring — none of this content is live,
 * and the audit found the All-Time Records page alone could render
 * 10+ simultaneously-glowing cards for what's fundamentally a "look up
 * a stat" task. Legacy rendering (.neon-panel + SECTION_COLORS.awards)
 * is unchanged.
 */
export function RankedCategoryCard({
  emoji,
  label,
  description,
  entries,
  emptyMessage,
  sectionColor = SECTION_COLORS.awards,
  beta = false,
}: {
  emoji: string;
  label: string;
  description?: string;
  entries: RankedCategoryEntry[];
  emptyMessage?: string;
  sectionColor?: string;
  beta?: boolean;
}) {
  return (
    <div
      className={beta ? "wl-card flex flex-col gap-2 rounded-xl p-4" : "neon-panel flex flex-col gap-2 rounded-xl p-4"}
      style={beta ? undefined : panelGlowStyle(sectionColor)}
    >
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <span aria-hidden>{emoji}</span>
          {label}
        </h3>
        {description && <p className="text-xs text-black/45 dark:text-white/45">{description}</p>}
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-black/50 dark:text-white/50">{emptyMessage ?? "No data yet."}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {entries.map((entry, i) => (
            <li key={entry.key} className="flex items-start gap-2 text-sm">
              <span className="w-5 shrink-0 text-center" aria-hidden>
                {RANK_MEDAL[i] ?? entry.rank}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  {entry.nameHref ? (
                    <Link href={entry.nameHref} className="break-words font-medium hover:underline">
                      {entry.name}
                    </Link>
                  ) : (
                    <span className="break-words font-medium">{entry.name}</span>
                  )}
                  <span className="shrink-0 tabular-nums text-black/70 dark:text-white/70">{entry.value}</span>
                </div>
                {entry.context && <p className="break-words text-xs text-black/50 dark:text-white/50">{entry.context}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
