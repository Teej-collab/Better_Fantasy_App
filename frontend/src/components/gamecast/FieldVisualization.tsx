import { nflTeamColor } from "@/lib/nfl-teams";
import type { LiveGame } from "@/lib/gamecastApi";

const YARD_TICKS = [0, 10, 20, 30, 40, 50, 40, 30, 20, 10, 0];

/**
 * A simplified, single-axis field — not a broadcast-quality rendering,
 * just enough to make ball position, line of scrimmage, and the first-
 * down marker immediately legible at a glance. `yards_to_goal` (0-100,
 * 0 = across the goal line) is the only position input; left/right
 * orientation always points the possessing team's drive rightward
 * (toward 0), so there's no need to track which physical end of a real
 * field either team defends. Ball/LOS/first-down markers use
 * .gamecast-marker (globals.css) so they glide to a new spot on
 * re-render instead of jumping.
 */
export function FieldVisualization({ game, beta = false }: { game: LiveGame; beta?: boolean }) {
  const hasLiveBall = game.status === "in_progress" && game.yards_to_goal !== null;
  const possessionColor = game.possession_team_abbr ? nflTeamColor(game.possession_team_abbr) : null;

  const ballPercent = hasLiveBall ? 100 - game.yards_to_goal! : 50;
  const firstDownPercent =
    hasLiveBall && game.distance !== null ? 100 - Math.max(0, game.yards_to_goal! - game.distance) : null;

  // The one live-tier card on this screen (Documentation/UX/
  // 01_Design_System.md's motion-budget rule) — the field literally
  // shows the ball moving, so it's the one place a static live accent
  // earns its keep; everything else on Gamecast goes flat under beta.
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl p-4 sm:p-5 ${beta ? (hasLiveBall ? "wl-card--live" : "wl-card") : "neon-panel"}`}
      style={!beta && possessionColor ? { ["--panel-glow" as string]: possessionColor } : undefined}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Field Position</h2>
        {game.is_redzone && (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-red-500 uppercase">
            Red Zone
          </span>
        )}
      </div>

      <div className="relative h-32 overflow-hidden rounded-lg border border-black/10 bg-gradient-to-b from-emerald-950/40 to-emerald-900/20 dark:border-white/10">
        {/* End zones */}
        <div className="absolute inset-y-0 left-0 w-[6%] border-r border-white/15 bg-black/25" aria-hidden />
        <div className="absolute inset-y-0 right-0 w-[6%] border-l border-white/15 bg-black/25" aria-hidden />

        {/* Yard ticks + labels, evenly spaced across the 6%-94% playing field */}
        <div className="absolute inset-x-[6%] inset-y-0" aria-hidden>
          {YARD_TICKS.map((yard, i) => {
            const left = (i / (YARD_TICKS.length - 1)) * 100;
            return (
              <div key={i} className="absolute inset-y-0 flex flex-col items-center" style={{ left: `${left}%` }}>
                <div className="h-full w-px bg-white/10" />
                <span className="absolute bottom-1 -translate-x-1/2 text-[9px] text-white/30 tabular-nums">{yard || "G"}</span>
              </div>
            );
          })}

          {firstDownPercent !== null && (
            <div
              className="gamecast-marker absolute inset-y-0 w-0.5 bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]"
              style={{ left: `${firstDownPercent}%` }}
              title="First down"
              aria-hidden
            />
          )}

          {hasLiveBall && (
            <div
              className="gamecast-marker absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-lg"
              style={{ left: `${ballPercent}%`, color: possessionColor ?? "var(--wl-accent)" }}
              aria-hidden
            >
              🏈
            </div>
          )}
        </div>

        {!hasLiveBall && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-white/40">
            {game.status === "final" ? "Game complete" : game.status === "scheduled" ? "Not started yet" : "—"}
          </div>
        )}
      </div>

      {hasLiveBall && (
        <p className="text-center text-sm text-black/60 dark:text-white/60">
          <span className="font-semibold" style={{ color: possessionColor ?? undefined }}>
            {game.possession_team_abbr}
          </span>{" "}
          ball · {game.field_position_label}
        </p>
      )}
    </div>
  );
}
