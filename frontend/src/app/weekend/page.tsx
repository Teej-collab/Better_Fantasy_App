import { getCurrentWeek, listSeasons } from "@/lib/api";
import { WeekendLanding } from "@/components/WeekendLanding";

export default async function WeekendPage() {
  const { seasons } = await listSeasons();
  const latestSeason = seasons.length > 0 ? Math.max(...seasons) : null;

  let matchupsHref = "/standings";
  let awardsHref = "/standings";

  if (latestSeason !== null) {
    // Same "don't default to week 0 preseason" logic as the Team page.
    const { current_week } = await getCurrentWeek(latestSeason);
    const week = current_week && current_week >= 1 ? current_week : 1;
    matchupsHref = `/seasons/${latestSeason}/weeks/${week}`;
    awardsHref = `/seasons/${latestSeason}/awards`;
  }

  return <WeekendLanding matchupsHref={matchupsHref} awardsHref={awardsHref} />;
}
