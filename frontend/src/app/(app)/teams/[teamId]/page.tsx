import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentWeek, getTeam, getTeamRoster, resolveWeek } from "@/lib/api";
import { RosterList } from "@/components/RosterList";

const WEEK_OPTIONS = Array.from({ length: 17 }, (_, i) => i + 1);

// Real per-page title (was falling back to the root layout's generic
// "Weekend League" for every page in the app — mobile audit finding)
// — matters most here since team pages are the kind of link an owner
// actually shares with the league. getTeam() is automatically deduped
// against the identical call in the page component below (Next's
// fetch request memoization), so this doesn't cost a second request.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ teamId: string }>;
}): Promise<Metadata> {
  const { teamId } = await params;
  const team = await getTeam(Number(teamId));
  return { title: `${team.team_name} — Weekend League` };
}

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { teamId } = await params;
  const { week: weekParam } = await searchParams;

  const team = await getTeam(Number(teamId));

  // Defaults to the season's actual current week (cached from the last
  // sync — see league_state) rather than always week 1, so this reads
  // like "your team right now" instead of requiring a manual click
  // every visit. Falls back to 1 if nothing's cached yet, or if it's
  // preseason — ESPN reports current_week as 0 before Week 1 starts,
  // and "week 0" isn't a real thing in our data.
  let week: number;
  if (weekParam) {
    week = Number(weekParam);
  } else {
    const { current_week } = await getCurrentWeek(team.season);
    week = resolveWeek(current_week);
  }

  const { roster } = await getTeamRoster(Number(teamId), week);

  const starters = roster.filter((p) => p.lineup_slot !== "BE" && p.lineup_slot !== "IR");
  const bench = roster.filter((p) => p.lineup_slot === "BE" || p.lineup_slot === "IR");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{team.team_name}</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          <Link href={`/owners/${team.owner_id}?season=${team.season}`} className="hover:underline">
            {team.owner_name}
          </Link>
          {" — "}
          {team.season} season
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {WEEK_OPTIONS.map((w) => (
          <Link
            key={w}
            href={`/teams/${teamId}?week=${w}`}
            className={
              w === week
                ? "rounded-full border border-black/20 bg-black/5 px-3 py-1.5 font-semibold dark:border-white/20 dark:bg-white/10"
                : "rounded-full border border-black/10 px-3 py-1.5 text-black/60 hover:bg-black/5 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
            }
          >
            Wk {w}
          </Link>
        ))}
      </div>

      {roster.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No roster data for week {week}.</p>
      ) : (
        <div className="flex flex-col gap-6">
          <RosterList title="Starters" players={starters} showProjected />
          <RosterList title="Bench / IR" players={bench} showProjected />
        </div>
      )}
    </div>
  );
}
