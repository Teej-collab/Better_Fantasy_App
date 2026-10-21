import { nflTeamColor } from "@/lib/nfl-teams";
import type { GamecastDrive, LiveGame } from "@/lib/gamecastApi";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

// The app's drive helpers (mobile/src/lib/gamecast.ts), on the web.
// Where the drive started, in yards to the end zone.
function startYardsToGoal(drive: GamecastDrive): number | null {
  const first = drive.plays.find((p) => p.play_type !== "kickoff" && p.yard_line != null && p.yard_line > 0);
  return first?.yard_line ?? null;
}

// Where it ended: a touchdown is 0, otherwise the start less the yards
// ESPN credits it (individual plays' spots are unreliable here — a
// punt's is measured from the other end).
function endYardsToGoal(drive: GamecastDrive): number | null {
  if (drive.result === "TD") return 0;
  const start = startYardsToGoal(drive);
  return start === null ? null : Math.min(100, Math.max(0, start - drive.yards));
}

const RESULT_LABELS: Record<string, string> = {
  TD: "Touchdown",
  FG: "Field goal",
  "MISSED FG": "Missed FG",
  PUNT: "Punt",
  TURNOVER: "Turnover",
  FUMBLE: "Fumble",
  INT: "Interception",
};

function resultLabel(result: string | null, current: boolean): string {
  if (current) return "Now";
  if (!result) return "—";
  if (result === "TD" || result === "FG") return result;
  const text = result.replace(/_/g, " ");
  return RESULT_LABELS[text.toUpperCase()] ?? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

const RESULT_COLORS: Record<string, string> = { TD: "#22c55e", FG: "#facc15", TURNOVER: "#ef4444", FUMBLE: "#ef4444", INT: "#ef4444", SAFETY: "#ef4444" };

/**
 * Every drive as a bar across a mini field — where it started, how far
 * it got, how it ended. A whole game's flow in one glance; the app's
 * Gamecast DriveChart on the web (2026-10). Newest drive on top.
 */
export function DriveChart({ game, beta = false }: { game: LiveGame; beta?: boolean }) {
  const drives = game.drives.filter((d) => d.plays.some((p) => p.play_type !== "kickoff"));
  if (drives.length === 0) return null;
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl p-4 sm:p-5 ${beta ? "wl-card" : "neon-panel"}`}
      style={beta ? undefined : panelGlowStyle(SECTION_COLORS.gamecast)}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Drive chart</h2>
        <span className="text-xs text-black/50 dark:text-white/50">{drives.length} drives</span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {[...drives].reverse().map((d) => {
          const current = game.current_drive?.drive_id === d.drive_id;
          const start = startYardsToGoal(d);
          const end = endYardsToGoal(d);
          // Percent across the field, left = own goal line.
          const left = start !== null ? 100 - start : 0;
          const right = end !== null ? 100 - end : left;
          const color = nflTeamColor(d.team_abbr) ?? "#4cc3ff";
          const resultColor = current ? "#39ff14" : d.result ? (RESULT_COLORS[d.result] ?? undefined) : undefined;
          return (
            <li
              key={d.drive_id}
              className="flex items-center gap-2 text-xs"
              aria-label={`${d.team_abbr} drive, ${d.play_count} plays, ${d.yards} yards, ${current ? "in progress" : resultLabel(d.result, false)}`}
            >
              <span className="w-9 shrink-0 font-bold" style={{ color }}>
                {d.team_abbr}
              </span>
              <span className="relative h-3 flex-1 rounded-sm bg-black/5 dark:bg-white/[0.06]">
                <span className="absolute inset-y-0 left-1/2 w-px bg-black/15 dark:bg-white/15" />
                <span
                  className={`absolute inset-y-0 rounded-sm ${current ? "ring-1 ring-white" : ""}`}
                  style={{ left: `${Math.min(left, right)}%`, width: `max(4px, ${Math.abs(right - left)}%)`, backgroundColor: color }}
                />
              </span>
              <span className="w-20 shrink-0 truncate text-right font-semibold" style={{ color: resultColor }}>
                {resultLabel(d.result, current)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
