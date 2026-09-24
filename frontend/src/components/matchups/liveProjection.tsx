import type { InGameInjury } from "@/lib/api";

// Shared by the matchup screen and My Team so a live projection and an
// in-game injury read the same everywhere (backend:
// app/domain/live_projection.py, app/domain/live_injuries.py).

const INJURY_LABELS: Record<Exclude<NonNullable<InGameInjury>["state"], "returned">, { short: string; long: string }> = {
  left: { short: "Hurt", long: "Left the game injured" },
  questionable_return: { short: "Q-return", long: "Questionable to return" },
  doubtful_return: { short: "D-return", long: "Doubtful to return" },
  ruled_out: { short: "Out", long: "Ruled out for the rest of the game" },
};

/** Small red tag next to a player's name while they're hurt mid-game.
 * Nothing once they've returned. */
export function InGameInjuryTag({ injury }: { injury: InGameInjury | undefined }) {
  if (!injury || injury.state === "returned") return null;
  const label = INJURY_LABELS[injury.state];
  return (
    <span
      className="ml-1.5 rounded bg-red-500/15 px-1 text-[10px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400"
      title={injury.detail ? `${label.long} — ${injury.detail}` : label.long}
    >
      {label.short}
    </span>
  );
}

/** Live projection with a ▲/▼ against the pregame number. */
export function LiveProjectionValue({
  live,
  pregame,
  className = "",
}: {
  live: number;
  pregame: number | null;
  className?: string;
}) {
  const diff = pregame == null ? 0 : live - pregame;
  const direction = diff >= 0.1 ? "up" : diff <= -0.1 ? "down" : null;
  return (
    <span
      className={`tabular-nums ${className}`}
      title={pregame != null ? `Live projection · pregame ${pregame.toFixed(1)}` : "Live projection"}
    >
      {live.toFixed(1)}
      {direction === "up" && <span className="ml-0.5 text-emerald-600 dark:text-emerald-400">▲</span>}
      {direction === "down" && <span className="ml-0.5 text-red-500 dark:text-red-400">▼</span>}
    </span>
  );
}
