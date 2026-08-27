import type { Metadata } from "next";
import { getAwardLeaderboards, getRecordBook, listSeasons } from "@/lib/api";
import { AwardLeaderboards } from "@/components/AwardLeaderboards";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { SeasonTabs } from "@/components/nav/SeasonTabs";
import { RecordBook } from "@/components/RecordBook";

export const metadata: Metadata = { title: "All-Time Records — Weekend League" };

/**
 * The All-Time Records tab of Awards — a pinned tab in SeasonTabs
 * alongside every season, not one more season itself (the record book
 * spans the league's whole history, see RecordBook.tsx). Kept under
 * /seasons/[season]/awards/ rather than a standalone /awards/all-time
 * route so the URL still carries which season you were last looking
 * at, matching the season tabs right next to it.
 */
export default async function AllTimeRecordsPage({
  params,
}: {
  params: Promise<{ season: string }>;
}) {
  const { season } = await params;
  const [{ seasons }, { categories }, { categories: awardCategories }] = await Promise.all([
    listSeasons(),
    getRecordBook(),
    getAwardLeaderboards(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="awards" awardsHref={`/seasons/${season}/awards`} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">Awards</h1>
        <SeasonTabs
          seasons={seasons}
          activeSeason={null}
          hrefFor={(s) => `/seasons/${s}/awards`}
          extraTab={{ label: "All-Time Records", href: `/seasons/${season}/awards/all-time`, active: true }}
        />
      </div>

      <RecordBook categories={categories} />
      <AwardLeaderboards categories={awardCategories} />
    </div>
  );
}
