import { getMatchup } from "@/lib/api";
import { RosterList } from "@/components/RosterList";

export default async function MatchupPage({
  params,
}: {
  params: Promise<{ matchupId: string }>;
}) {
  const { matchupId } = await params;
  const matchup = await getMatchup(Number(matchupId));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {matchup.season} — Week {matchup.week}
          {matchup.is_playoff ? " (Playoffs)" : ""}
        </h1>
        <div className="mt-2 flex flex-col gap-1 text-lg sm:flex-row sm:items-center sm:gap-4">
          <TeamScore teamId={matchup.home_team_id} name={matchup.home_team_name} score={matchup.home_score} />
          <span className="hidden text-black/40 sm:inline dark:text-white/40">vs</span>
          <TeamScore teamId={matchup.away_team_id} name={matchup.away_team_name} score={matchup.away_score} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <RosterList title={matchup.home_team_name} players={matchup.home_roster} />
        <RosterList title={matchup.away_team_name} players={matchup.away_roster} />
      </div>
    </div>
  );
}

function TeamScore({ teamId, name, score }: { teamId: number; name: string; score: string | null }) {
  return (
    <a href={`/teams/${teamId}`} className="flex items-baseline gap-2 hover:underline">
      <span>{name}</span>
      <span className="font-mono tabular-nums text-black/70 dark:text-white/70">
        {score !== null ? Number(score).toFixed(1) : "—"}
      </span>
    </a>
  );
}
