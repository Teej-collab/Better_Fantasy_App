import {
  getCareerProfile,
  getOwnerBadges,
  getSeasonProfile,
  listSeasons,
  type PeriodSummary,
} from "@/lib/api";

export default async function OwnerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ ownerId: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { ownerId } = await params;
  const ownerIdNum = Number(ownerId);
  const { seasons } = await listSeasons();
  const latestSeason = Math.max(...seasons);
  const { season: seasonParam } = await searchParams;
  const season = seasonParam ? Number(seasonParam) : latestSeason;

  const [seasonProfile, career, badges] = await Promise.all([
    getSeasonProfile(ownerIdNum, season),
    getCareerProfile(ownerIdNum),
    getOwnerBadges(ownerIdNum),
  ]);

  if (!career) {
    return <p className="py-12 text-center text-sm text-black/50 dark:text-white/50">No data for this owner.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">{career.team_name}</h1>
        <Badges championshipYears={badges.championship_years} awardSummary={badges.award_summary} />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 className="font-medium">Season</h2>
          <div className="flex flex-wrap gap-x-3 text-sm">
            {[...seasons].reverse().map((s) => (
              <a
                key={s}
                href={`/owners/${ownerId}?season=${s}`}
                className={
                  s === season
                    ? "font-semibold underline"
                    : "text-black/60 hover:underline dark:text-white/60"
                }
              >
                {s}
              </a>
            ))}
          </div>
        </div>

        {seasonProfile ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <PeriodCard title="Regular season" summary={seasonProfile.regular} />
              <PeriodCard title="Playoffs" summary={seasonProfile.playoff} />
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="Best week" value={seasonProfile.best_week ? `Wk ${seasonProfile.best_week.week} — ${seasonProfile.best_week.score}` : "—"} />
              <Stat label="Worst week" value={seasonProfile.worst_week ? `Wk ${seasonProfile.worst_week.week} — ${seasonProfile.worst_week.score}` : "—"} />
              <Stat label="Avg luck" value={seasonProfile.avg_luck ?? "—"} />
              <Stat label="Power rank" value={seasonProfile.current_power_rank ?? "—"} />
            </dl>
          </div>
        ) : (
          <p className="text-sm text-black/50 dark:text-white/50">No data for {season}.</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Career ({career.seasons[0]}–{career.seasons[career.seasons.length - 1]})</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PeriodCard title="Regular season" summary={career.regular} />
          <PeriodCard title="Playoffs" summary={career.playoff} />
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat
            label="Best season"
            value={career.best_season ? `${career.best_season.season} (${career.best_season.record})` : "—"}
          />
          <Stat
            label="Worst season"
            value={career.worst_season ? `${career.worst_season.season} (${career.worst_season.record})` : "—"}
          />
          <Stat
            label="Best week ever"
            value={career.best_week ? `${career.best_week.season} Wk ${career.best_week.week} — ${career.best_week.score}` : "—"}
          />
          <Stat
            label="Worst week ever"
            value={career.worst_week ? `${career.worst_week.season} Wk ${career.worst_week.week} — ${career.worst_week.score}` : "—"}
          />
        </dl>
      </section>
    </div>
  );
}

function Badges({
  championshipYears,
  awardSummary,
}: {
  championshipYears: number[];
  awardSummary: Record<string, number[]>;
}) {
  if (championshipYears.length === 0 && Object.keys(awardSummary).length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {championshipYears.length > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2.5 py-1 text-xs font-medium text-amber-900 dark:bg-amber-400/20 dark:text-amber-300">
          🏆 {championshipYears.length > 1 ? `${championshipYears.length}x Champion` : "Champion"} ({championshipYears.join(", ")})
        </span>
      )}
      {Object.entries(awardSummary).map(([awardType, years]) => (
        <span
          key={awardType}
          className="inline-flex items-center gap-1 rounded-full border border-black/10 px-2.5 py-1 text-xs text-black/70 dark:border-white/10 dark:text-white/70"
        >
          {years.length > 1 ? `${years.length}x ` : ""}
          {awardType}
        </span>
      ))}
    </div>
  );
}

function PeriodCard({ title, summary }: { title: string; summary: PeriodSummary | null }) {
  return (
    <div className="neon-panel rounded-lg p-4">
      <h3 className="mb-2 text-sm font-medium text-black/60 dark:text-white/60">{title}</h3>
      {summary ? (
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <Stat label="Record" value={summary.record} />
          <Stat label="PF" value={summary.pf} />
          <Stat label="PA" value={summary.pa} />
        </dl>
      ) : (
        <p className="text-sm text-black/40 dark:text-white/40">No games</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-black/50 dark:text-white/50">{label}</dt>
      <dd className="tabular-nums font-medium">{value}</dd>
    </div>
  );
}
