import type { MatchupRivalry } from "@/lib/api";

// One color per tier so different rivalries read as visually distinct
// at a glance, not just differently-worded copies of the same badge.
// Falls back to the "Developing" look for any tier value not in this
// list, rather than erroring on an unexpected string.
const TIER_BADGE_CLASS: Record<string, string> = {
  Legendary: "bg-purple-100 text-purple-800 dark:bg-purple-400/20 dark:text-purple-300",
  Historic: "bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-300",
  Developing: "bg-slate-100 text-slate-700 dark:bg-slate-400/20 dark:text-slate-300",
};

export function GameOfWeekBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-400/20 dark:text-amber-300">
      {"⭐"} Game of the Week
    </span>
  );
}

export function RivalryBadge({ rivalry }: { rivalry: MatchupRivalry }) {
  const colorClass = TIER_BADGE_CLASS[rivalry.tier ?? ""] ?? TIER_BADGE_CLASS.Developing;
  return (
    <span
      title={rivalry.tier ? `${rivalry.tier} rivalry` : undefined}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${colorClass}`}
    >
      {rivalry.emoji ?? "\u{1F525}"} {rivalry.name}
    </span>
  );
}

// Small, badge-style callouts for a team's own headline bench crime or
// clutch/choke status this week — same icon vocabulary the homepage's
// weekly-awards tiles already use (buildAwardTiles in app/(home)/
// page.tsx), so a 💀/🎯/😬 means the same thing everywhere in the app.
export function BenchCrimeBadge({
  crime,
}: {
  crime: { bench_player: string; started_player: string; points_diff: number };
}) {
  return (
    <span
      title={`Benched ${crime.bench_player}, started ${crime.started_player}`}
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 dark:bg-slate-400/20 dark:text-slate-300"
    >
      {"\u{1F480}"} Bench crime: +{crime.points_diff.toFixed(1)} left on the bench
    </span>
  );
}

export function ClutchChokeBadge({ status }: { status: { label: "clutch" | "choke"; reason: string } }) {
  const isClutch = status.label === "clutch";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
        isClutch
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/20 dark:text-emerald-300"
          : "bg-rose-100 text-rose-800 dark:bg-rose-400/20 dark:text-rose-300"
      }`}
    >
      {isClutch ? "\u{1F3AF} Clutch" : "\u{1F62C} Choke"} — {status.reason}
    </span>
  );
}
