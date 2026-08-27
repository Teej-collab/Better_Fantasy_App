import type { Metadata } from "next";
import Link from "next/link";
import { getSeasonAwards, listSeasons } from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { SeasonTabs } from "@/components/nav/SeasonTabs";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ season: string }>;
}): Promise<Metadata> {
  const { season } = await params;
  return { title: `${season} Awards — Weekend League` };
}

export default async function SeasonAwardsPage({
  params,
}: {
  params: Promise<{ season: string }>;
}) {
  const { season } = await params;
  const [{ seasons }, { champion, awards }] = await Promise.all([
    listSeasons(),
    getSeasonAwards(Number(season)),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="awards" awardsHref={`/seasons/${season}/awards`} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">Awards</h1>
        <SeasonTabs
          seasons={seasons}
          activeSeason={season}
          hrefFor={(s) => `/seasons/${s}/awards`}
          extraTab={{ label: "All-Time Records", href: `/seasons/${season}/awards/all-time`, active: false }}
        />
      </div>

      {champion && (
        <div
          className="neon-panel flex items-center gap-3 rounded-lg bg-black/[0.015] p-4 dark:bg-white/[0.03]"
          style={panelGlowStyle(SECTION_COLORS.awards)}
        >
          <span className="text-2xl">🏆</span>
          <div>
            <p className="font-medium">{champion.team_name}</p>
            <Link href={`/owners/${champion.owner_id}`} className="text-sm text-black/60 hover:underline dark:text-white/60">
              {champion.owner_name}
            </Link>
          </div>
        </div>
      )}

      {awards.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No awards recorded for {season} yet.</p>
      ) : (
        <div
          className="neon-panel flex flex-col rounded-lg bg-black/[0.015] px-4 dark:bg-white/[0.03]"
          style={panelGlowStyle(SECTION_COLORS.awards)}
        >
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
            {awards.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{a.award_type}</p>
                  {a.detail && <p className="text-sm text-black/50 dark:text-white/50">{a.detail}</p>}
                </div>
                <Link
                  href={`/owners/${a.owner_id}`}
                  className="shrink-0 text-sm text-black/70 hover:underline dark:text-white/70"
                >
                  {a.owner_name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
