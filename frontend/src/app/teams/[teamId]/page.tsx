import { getTeamRoster } from "@/lib/api";

const WEEK_OPTIONS = Array.from({ length: 17 }, (_, i) => i + 1);

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { teamId } = await params;
  const { week: weekParam } = await searchParams;
  const week = weekParam ? Number(weekParam) : 1;

  const { team, roster } = await getTeamRoster(Number(teamId), week);

  const starters = roster.filter((p) => p.lineup_slot !== "BE" && p.lineup_slot !== "IR");
  const bench = roster.filter((p) => p.lineup_slot === "BE" || p.lineup_slot === "IR");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{team.team_name}</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          {team.owner_name} — {team.season} season
        </p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {WEEK_OPTIONS.map((w) => (
          <a
            key={w}
            href={`/teams/${teamId}?week=${w}`}
            className={
              w === week
                ? "rounded-full border border-black/20 bg-black/5 px-2.5 py-1 font-semibold dark:border-white/20 dark:bg-white/10"
                : "rounded-full border border-black/10 px-2.5 py-1 text-black/60 hover:bg-black/5 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
            }
          >
            Wk {w}
          </a>
        ))}
      </div>

      {roster.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No roster data for week {week}.</p>
      ) : (
        <div className="flex flex-col gap-6">
          <RosterTable title="Starters" players={starters} />
          <RosterTable title="Bench / IR" players={bench} />
        </div>
      )}
    </div>
  );
}

function RosterTable({
  title,
  players,
}: {
  title: string;
  players: Array<{
    player_name: string;
    position: string | null;
    lineup_slot: string | null;
    points_scored: string | null;
    points_projected: string | null;
  }>;
}) {
  if (players.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 text-sm font-medium text-black/60 dark:text-white/60">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left dark:border-white/10">
              <th className="py-2 pr-2">Slot</th>
              <th className="py-2 pr-2">Player</th>
              <th className="py-2 pr-2">Pos</th>
              <th className="py-2 pr-2 text-right">Proj</th>
              <th className="py-2 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => (
              <tr key={i} className="border-b border-black/5 dark:border-white/5">
                <td className="py-2 pr-2 text-black/50 dark:text-white/50">{p.lineup_slot}</td>
                <td className="py-2 pr-2">{p.player_name}</td>
                <td className="py-2 pr-2 text-black/60 dark:text-white/60">{p.position}</td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {p.points_projected !== null ? Number(p.points_projected).toFixed(1) : "—"}
                </td>
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
