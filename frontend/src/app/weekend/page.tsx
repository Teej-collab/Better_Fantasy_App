import type { Metadata } from "next";
import { awardsHrefFor, listSeasons, matchupsHrefFor, safeLatestSeason } from "@/lib/api";
import { WeekendLanding } from "@/components/WeekendLanding";

export const metadata: Metadata = { title: "The Weekend" };

export default async function WeekendPage() {
  const { seasons } = await listSeasons();
  const latestSeason = safeLatestSeason(seasons);

  const matchupsHref = matchupsHrefFor();
  const awardsHref = awardsHrefFor(latestSeason);

  return <WeekendLanding matchupsHref={matchupsHref} awardsHref={awardsHref} />;
}
