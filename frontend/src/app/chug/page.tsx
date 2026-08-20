import { getChugLeaderboard, getChugSeasons } from "@/lib/api";

export default async function ChugLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: seasonParam } = await searchParams;
  const season = seasonParam ? Number(seasonParam) : undefined;

  const [{ seasons }, { leaderboard }] = await Promise.all([getChugSeasons(), getChugLeaderboard(season)]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">🍺 Chug Leaderboard</h1>
        <div className="flex flex-wrap gap-x-3 text-sm">
          <a
            href="/chug"
            className={
              season === undefined ? "font-semibold underline" : "text-black/60 hover:underline dark:text-white/60"
            }
          >
            All-Time
          </a>
          {[...seasons].reverse().map((s) => (
            <a
              key={s}
              href={`/chug?season=${s}`}
              className={
                s === season ? "font-semibold underline" : "text-black/60 hover:underline dark:text-white/60"
              }
            >
              {s}
            </a>
          ))}
        </div>
      </div>

      <p className="text-sm text-black/50 dark:text-white/50">
        The rule: any active roster spot (not bench, not IR) that scores 0 or fewer points owes its owner one chug.
      </p>

      {leaderboard.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No chug data yet.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-black/5 rounded-lg border border-black/10 bg-black/[0.015] shadow-sm dark:divide-white/5 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
          {leaderboard.map((row, i) => (
            <li key={row.owner_id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="flex min-w-0 items-center gap-3">
                <span className="w-5 shrink-0 text-black/40 tabular-nums dark:text-white/40">{i + 1}</span>
                <a href={`/owners/${row.owner_id}`} className="truncate font-medium hover:underline">
                  {row.owner_name}
                </a>
              </span>
              <span className="flex shrink-0 items-center gap-4 tabular-nums text-black/70 dark:text-white/70">
                <span>
                  {row.completed}/{row.owed} done
                </span>
                {row.avg_grade !== null && (
                  <span className="text-xs text-black/50 dark:text-white/50">avg {row.avg_grade}/10</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
