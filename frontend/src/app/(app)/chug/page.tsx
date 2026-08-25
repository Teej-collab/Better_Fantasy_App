import { cookies } from "next/headers";
import Link from "next/link";
import { awardsHrefFor, getChugLeaderboard, getChugSeasons, getMe, listSeasons, safeLatestSeason } from "@/lib/api";
import { ChugUpload } from "@/components/ChugUpload";
import { ChugFineButton } from "@/components/ChugFineButton";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { SeasonTabs } from "@/components/nav/SeasonTabs";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

export default async function ChugLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: seasonParam } = await searchParams;
  const season = seasonParam ? Number(seasonParam) : undefined;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  const [{ seasons }, { leaderboard }, me, { seasons: allSeasons }] = await Promise.all([
    getChugSeasons(),
    getChugLeaderboard(season),
    getMe(sessionCookie),
    listSeasons(),
  ]);
  const latestSeason = safeLatestSeason(allSeasons);

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="chug" awardsHref={awardsHrefFor(latestSeason)} />
      {me && <ChugUpload />}

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">🍺 Chug Leaderboard</h1>
        <SeasonTabs
          seasons={seasons}
          activeSeason={season ?? null}
          hrefFor={(s) => `/chug?season=${s}`}
          extraTab={{ label: "All-Time", href: "/chug", active: season === undefined }}
        />
      </div>

      <p className="text-sm text-black/50 dark:text-white/50">
        The rule: any active roster spot (not bench, not IR) that scores 0 or fewer points owes its owner one chug.
        Not paid down by Monday Night Football kickoff? The remaining balance doubles — up to 3 weeks running,
        after which it converts to a $10/chug fine only a commissioner can clear.
      </p>

      {leaderboard.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No chug data yet.</p>
      ) : (
        <ol
          className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
          style={panelGlowStyle(SECTION_COLORS.chug)}
        >
          {leaderboard.map((row, i) => (
            <li key={row.owner_id} className="flex flex-col gap-1.5 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="w-5 shrink-0 text-black/40 tabular-nums dark:text-white/40">{i + 1}</span>
                  <Link href={`/owners/${row.owner_id}`} className="truncate font-medium hover:underline">
                    {row.owner_name}
                  </Link>
                </span>
                <span className="flex shrink-0 items-center gap-4 tabular-nums text-black/70 dark:text-white/70">
                  <span>
                    {row.completed}/{row.owed} done
                  </span>
                  {row.avg_grade !== null && (
                    <span className="text-xs text-black/50 dark:text-white/50">avg {row.avg_grade}/10</span>
                  )}
                </span>
              </div>

              <div className="ml-8 flex flex-wrap items-center gap-2 text-xs">
                {row.outstanding_owed > 0 && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-400">
                    {row.outstanding_owed} owed right now
                  </span>
                )}
                {row.fined_owed > 0 && (
                  <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 font-medium text-red-600 dark:text-red-400">
                    ${row.fine_amount} fine ({row.fined_owed} chugs)
                    {me?.is_commissioner && <ChugFineButton ownerId={row.owner_id} fineAmount={row.fine_amount} />}
                  </span>
                )}
                <span className="text-black/40 dark:text-white/40">Lifetime: {row.lifetime_completed}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
