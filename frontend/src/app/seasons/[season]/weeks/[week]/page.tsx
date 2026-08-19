import { listWeekMatchups } from "@/lib/api";
import { PlayoffBadge } from "@/components/PlayoffBadge";

const WEEK_OPTIONS = Array.from({ length: 17 }, (_, i) => i + 1);

export default async function WeekMatchupsPage({
  params,
}: {
  params: Promise<{ season: string; week: string }>;
}) {
  const { season, week } = await params;
  const { matchups } = await listWeekMatchups(Number(season), Number(week));
  const isPlayoffWeek = matchups.some((m) => m.is_playoff);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        {season} — Week {week}
        {isPlayoffWeek && <PlayoffBadge />}
      </h1>

      <div className="flex flex-wrap gap-2 text-sm">
        {WEEK_OPTIONS.map((w) => (
          <a
            key={w}
            href={`/seasons/${season}/weeks/${w}`}
            className={
              String(w) === week
                ? "rounded-full border border-black/20 bg-black/5 px-3 py-1.5 font-semibold dark:border-white/20 dark:bg-white/10"
                : "rounded-full border border-black/10 px-3 py-1.5 text-black/60 hover:bg-black/5 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
            }
          >
            {w}
          </a>
        ))}
      </div>

      {matchups.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No matchups for this week.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
          {matchups.map((m) => (
            <li key={m.matchup_id}>
              <a
                href={`/matchups/${m.matchup_id}`}
                className="flex flex-col gap-1 py-3 hover:underline sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
                  <span className="truncate">{m.home_team_name}</span>
                  <span className="text-xs text-black/40 sm:text-sm dark:text-white/40">vs</span>
                  <span className="truncate">{m.away_team_name}</span>
                </span>
                <span className="shrink-0 font-mono tabular-nums text-black/70 dark:text-white/70">
                  {m.home_score !== null ? Number(m.home_score).toFixed(1) : "—"} –{" "}
                  {m.away_score !== null ? Number(m.away_score).toFixed(1) : "—"}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
