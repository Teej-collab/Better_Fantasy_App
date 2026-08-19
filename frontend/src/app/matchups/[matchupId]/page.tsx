import { getMatchup, type RosterPlayer } from "@/lib/api";

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
        <div className="mt-2 flex items-center gap-4 text-lg">
          <TeamScore teamId={matchup.home_team_id} name={matchup.home_team_name} score={matchup.home_score} />
          <span className="text-black/40 dark:text-white/40">vs</span>
          <TeamScore teamId={matchup.away_team_id} name={matchup.away_team_name} score={matchup.away_score} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <RosterColumn title={matchup.home_team_name} players={matchup.home_roster} />
        <RosterColumn title={matchup.away_team_name} players={matchup.away_roster} />
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

function RosterColumn({ title, players }: { title: string; players: RosterPlayer[] }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-medium text-black/60 dark:text-white/60">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left dark:border-white/10">
              <th className="py-2 pr-2">Slot</th>
              <th className="py-2 pr-2">Player</th>
              <th className="py-2 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => (
              <tr key={i} className="border-b border-black/5 dark:border-white/5">
                <td className="py-2 pr-2 text-black/50 dark:text-white/50">{p.lineup_slot}</td>
                <td className="py-2 pr-2">{p.player_name}</td>
                <td className="py-2 text-right tabular-nums">
                  {p.points_scored !== null ? Number(p.points_scored).toFixed(1) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
