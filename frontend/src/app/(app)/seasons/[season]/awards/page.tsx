import { getSeasonAwards, listSeasons } from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";

export default async function SeasonAwardsPage({
  params,
}: {
  params: Promise<{ season: string }>;
}) {
  const { season } = await params;
  const { seasons } = await listSeasons();
  const { champion, awards } = await getSeasonAwards(Number(season));

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="awards" awardsHref={`/seasons/${season}/awards`} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">Awards</h1>
        <div className="flex flex-wrap gap-x-3 text-sm">
          {[...seasons].reverse().map((s) => (
            <a
              key={s}
              href={`/seasons/${s}/awards`}
              className={
                String(s) === season
                  ? "font-semibold underline"
                  : "text-black/60 hover:underline dark:text-white/60"
              }
            >
              {s}
            </a>
          ))}
        </div>
      </div>

      {champion && (
        <div className="flex items-center gap-3 rounded-lg bg-amber-50 p-4 dark:bg-amber-400/10">
          <span className="text-2xl">🏆</span>
          <div>
            <p className="font-medium">{champion.team_name}</p>
            <a href={`/owners/${champion.owner_id}`} className="text-sm text-black/60 hover:underline dark:text-white/60">
              {champion.owner_name}
            </a>
          </div>
        </div>
      )}

      {awards.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No awards recorded for {season} yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
          {awards.map((a, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium">{a.award_type}</p>
                {a.detail && <p className="text-sm text-black/50 dark:text-white/50">{a.detail}</p>}
              </div>
              <a
                href={`/owners/${a.owner_id}`}
                className="shrink-0 text-sm text-black/70 hover:underline dark:text-white/70"
              >
                {a.owner_name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
