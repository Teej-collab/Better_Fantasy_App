import { nflTeamColor } from "@/lib/nfl-teams";
import type { LiveGame } from "@/lib/gamecastApi";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

/**
 * The active drive, prominently — team, plays/yards/time so far, and
 * where things stand right now. A simple filled bar stands in for
 * "how much of the field this drive has covered" (start yard line to
 * current position), not a literal replay of every play (that's
 * PlayByPlay.tsx's job).
 */
export function CurrentDrive({ game, beta = false }: { game: LiveGame; beta?: boolean }) {
  const drive = game.current_drive;
  const color = drive ? nflTeamColor(drive.team_abbr) : null;

  if (!drive) {
    return (
      <div
        className={`flex flex-col gap-2 rounded-xl p-4 sm:p-5 ${beta ? "wl-card" : "neon-panel"}`}
        style={beta ? undefined : panelGlowStyle(SECTION_COLORS.matchups)}
      >
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Current Drive</h2>
        <p className="text-sm text-black/50 dark:text-white/50">No drive in progress.</p>
      </div>
    );
  }

  const currentYardLine = game.yards_to_goal !== null ? 100 - game.yards_to_goal : drive.start_yard_line;
  const progressPercent = Math.min(100, Math.max(0, currentYardLine - drive.start_yard_line + 5));

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl p-4 sm:p-5 ${beta ? "wl-card" : "neon-panel"}`}
      style={beta ? undefined : { ["--panel-glow" as string]: color ?? SECTION_COLORS.matchups }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Current Drive</h2>
        <span className="text-sm font-bold" style={{ color: color ?? undefined }}>
          {drive.team_abbr}
        </span>
      </div>

      <div className="flex items-baseline gap-4 text-sm">
        <span className="tabular-nums">
          <strong>{drive.play_count}</strong> plays
        </span>
        <span className="tabular-nums">
          <strong>{drive.yards}</strong> yards
        </span>
        <span className="tabular-nums">
          <strong>{drive.duration}</strong>
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className="gamecast-marker h-full rounded-full"
          style={{ width: `${progressPercent}%`, backgroundColor: color ?? "var(--wl-accent)" }}
        />
      </div>

      {game.down !== null && game.distance !== null && (
        <p className="text-sm text-black/70 dark:text-white/70">
          {ordinal(game.down)} &amp; {game.distance}
          {game.field_position_label && ` · ${game.field_position_label}`}
        </p>
      )}
    </div>
  );
}

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}
