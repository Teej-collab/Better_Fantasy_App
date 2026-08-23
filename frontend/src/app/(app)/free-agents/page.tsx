import { getFreeAgents, getWaiverSettings } from "@/lib/api";
import { FreeAgentsList } from "@/components/FreeAgentsList";

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
        , not ESPN&apos;s newer bidding format.
      </p>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs text-black/70 dark:text-white/70">
        Tap <strong>Add</strong> to preview a move against your real roster — who&apos;d need to be dropped, if
        anyone. Nothing is submitted to ESPN yet; make the real move in the ESPN app.
      </div>

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

      <FreeAgentsList players={players} />
    </div>
  );
}
