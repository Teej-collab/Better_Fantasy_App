import { listWeekMatchups } from "@/lib/api";

const WEEK_OPTIONS = Array.from({ length: 17 }, (_, i) => i + 1);

export default async function WeekMatchupsPage({
  params,
}: {
  params: Promise<{ season: string; week: string }>;
}) {
  const { season, week } = await params;
  const { matchups } = await listWeekMatchups(Number(season), Number(week));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">
        {season} — Week {week}
      </h1>

      <div className="flex flex-wrap gap-2 text-sm">
        {WEEK_OPTIONS.map((w) => (
          <a
            key={w}
            href={`/seasons/${season}/weeks/${w}`}
            className={
              String(w) === week
                ? "rounded-full border border-black/20 bg-black/5 px-2.5 py-1 font-semibold dark:border-white/20 dark:bg-white/10"
                : "rounded-full border border-black/10 px-2.5 py-1 text-black/60 hover:bg-black/5 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
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
            <li key={m.matchup_id} className="py-3">
              <a href={`/matchups/${m.matchup_id}`} className="flex items-center justify-between hover:underline">
                <span>
                  {m.home_team_name} vs {m.away_team_name}
                </span>
                <span className="font-mono tabular-nums text-black/70 dark:text-white/70">
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
