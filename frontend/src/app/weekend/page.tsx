import { awardsHrefFor, getCurrentWeek, listSeasons, matchupsHrefFor, resolveWeek, safeLatestSeason } from "@/lib/api";
import { WeekendLanding } from "@/components/WeekendLanding";

export default async function WeekendPage() {
  const { seasons } = await listSeasons();
  const latestSeason = safeLatestSeason(seasons);

  let week: number | null = null;
  if (latestSeason !== null) {
    const { current_week } = await getCurrentWeek(latestSeason);
    week = resolveWeek(current_week);
  }
  const matchupsHref = matchupsHrefFor(latestSeason, week);
  const awardsHref = awardsHrefFor(latestSeason);

  return <WeekendLanding matchupsHref={matchupsHref} awardsHref={awardsHref} />;
}
