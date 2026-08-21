import { getFreeAgents, getWaiverSettings } from "@/lib/api";

const POSITIONS = ["QB", "RB", "WR", "TE", "D/ST", "K"];

export default async function FreeAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ position?: string }>;
}) {
  const { position } = await searchParams;

  const [{ players }, waiverSettings] = await Promise.all([
    getFreeAgents(position, 50),
    getWaiverSettings(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Free Agents</h1>

      <p className="text-sm text-black/50 dark:text-white/50">
        Every NFL player not currently on a roster in this league, sorted by real ownership. This league uses{" "}
        {waiverSettings.uses_faab ? `FAAB bidding ($${waiverSettings.acquisition_budget} budget)` : "standard waiver priority"}
        , not ESPN&apos;s newer bidding format. Browsing only for now — add these through the ESPN app.
      </p>

      <div className="flex flex-wrap gap-x-3 text-sm">
        <a
          href="/free-agents"
          className={
            !position ? "font-semibold underline" : "text-black/60 hover:underline dark:text-white/60"
          }
        >
          All
        </a>
        {POSITIONS.map((p) => (
          <a
            key={p}
            href={`/free-agents?position=${encodeURIComponent(p)}`}
            className={
              position === p ? "font-semibold underline" : "text-black/60 hover:underline dark:text-white/60"
            }
          >
            {p}
          </a>
        ))}
      </div>

      {players.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">No free agents found.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-black/5 rounded-lg border border-black/10 bg-black/[0.015] shadow-sm dark:divide-white/5 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
          {players.map((p, i) => (
            <li key={p.player_id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="flex min-w-0 items-center gap-3">
                <span className="w-5 shrink-0 text-black/40 tabular-nums dark:text-white/40">{i + 1}</span>
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-1.5 truncate font-medium">
                    {p.name}
                    {p.injury_status && p.injury_status !== "ACTIVE" && (
                      <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 uppercase dark:text-red-400">
                        {p.injury_status}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-black/50 dark:text-white/50">
                    {p.position} · {p.pro_team}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-4 text-right text-xs tabular-nums text-black/60 dark:text-white/60">
                <span className="flex flex-col items-end">
                  <span className="font-semibold">{p.projected_points ?? "—"}</span>
                  <span className="text-black/40 dark:text-white/40">projected</span>
                </span>
                <span className="flex flex-col items-end">
                  <span className="font-semibold">{p.percent_owned}%</span>
                  <span className="text-black/40 dark:text-white/40">owned</span>
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
