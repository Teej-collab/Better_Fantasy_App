import Image from "next/image";
import { nflTeamColor, nflTeamName, teamLogoUrl } from "@/lib/nfl-teams";
import type { LiveGame } from "@/lib/gamecastApi";

/**
 * Score, quarter/clock, possession, and connection honesty — the one
 * thing a visitor should never wonder about. "● LIVE" only appears
 * while actually connected and in_progress; anything else (halftime,
 * reconnecting, final) says so explicitly rather than leaving a stale
 * LIVE badge up.
 */
export function GameHeader({
  game,
  connected,
  updatedSecondsAgo,
  beta = false,
}: {
  game: LiveGame;
  connected: boolean;
  updatedSecondsAgo: number;
  // Settings > Labs > "Try the new look" — see GamecastShell.tsx.
  beta?: boolean;
}) {
  const isLive = game.status === "in_progress";
  const homeColor = nflTeamColor(game.home_team.abbr) ?? "var(--wl-text)";
  const awayColor = nflTeamColor(game.away_team.abbr) ?? "var(--wl-text)";
  const homeHasBall = game.possession_team_abbr === game.home_team.abbr;
  const awayHasBall = game.possession_team_abbr === game.away_team.abbr;

  return (
    <div className={`flex flex-col gap-4 rounded-xl p-4 sm:p-5 ${beta ? "wl-card" : "neon-panel"}`}>
      <div className="flex items-center justify-between text-xs">
        <StatusBadge game={game} connected={connected} />
        <span className="text-black/50 dark:text-white/50">
          {connected ? `Updated ${updatedSecondsAgo}s ago` : "Reconnecting…"}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
        <TeamBlock
          abbr={game.away_team.abbr}
          score={game.away_team.score}
          color={awayColor}
          hasBall={awayHasBall}
          align="left"
        />

        <div className="flex flex-col items-center gap-0.5">
          <span className="text-sm font-semibold tabular-nums sm:text-base">
            {game.period_label ?? (game.status === "scheduled" ? "—" : game.status.toUpperCase())}
          </span>
          {game.clock && <span className="text-xs text-black/50 tabular-nums dark:text-white/50">{game.clock}</span>}
        </div>

        <TeamBlock
          abbr={game.home_team.abbr}
          score={game.home_team.score}
          color={homeColor}
          hasBall={homeHasBall}
          align="right"
        />
      </div>

      {isLive && game.down !== null && game.distance !== null && (
        <p className="text-center text-sm text-black/70 dark:text-white/70">
          <span className="font-semibold" style={{ color: game.possession_team_abbr ? nflTeamColor(game.possession_team_abbr) ?? undefined : undefined }}>
            {game.possession_team_abbr}
          </span>{" "}
          ball · {ordinal(game.down)} &amp; {game.distance}
          {game.field_position_label && ` · ${game.field_position_label}`}
        </p>
      )}
    </div>
  );
}

function TeamBlock({
  abbr,
  score,
  color,
  hasBall,
  align,
}: {
  abbr: string;
  score: number;
  color: string;
  hasBall: boolean;
  align: "left" | "right";
}) {
  const logo = teamLogoUrl(abbr);
  return (
    <div className={`flex items-center gap-2.5 ${align === "right" ? "flex-row-reverse text-right" : "text-left"}`}>
      {logo && (
        <Image
          src={logo}
          alt={nflTeamName(abbr) ?? abbr}
          width={40}
          height={40}
          className="h-8 w-8 shrink-0 sm:h-10 sm:w-10"
          unoptimized
        />
      )}
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 text-sm font-bold tracking-wide sm:text-base" style={{ color }}>
          {align === "right" && hasBall && <PossessionDot />}
          {abbr}
          {align === "left" && hasBall && <PossessionDot />}
        </span>
        <span className="text-xl font-bold tabular-nums sm:text-2xl">{score}</span>
      </div>
    </div>
  );
}

// A football glyph, not .live-dot (a fixed red pulsing dot used
// elsewhere for the "● LIVE" status badge) — reusing that here made
// possession genuinely easy to miss/confuse with "this game is live"
// rather than "this specific team has the ball" (2026-09 finding).
function PossessionDot() {
  return (
    <span className="text-xs" aria-hidden title="Has possession">
      🏈
    </span>
  );
}

function StatusBadge({ game, connected }: { game: LiveGame; connected: boolean }) {
  if (!connected) {
    return (
      <span className="flex items-center gap-1.5 font-semibold tracking-wide text-amber-500 uppercase">
        <span className="live-dot live-dot--idle" aria-hidden />
        Delayed
      </span>
    );
  }
  if (game.status === "in_progress") {
    return (
      <span className="flex items-center gap-1.5 font-semibold tracking-wide text-[var(--wl-live)] uppercase">
        <span className="live-dot" aria-hidden />
        Live
      </span>
    );
  }
  if (game.status === "halftime") {
    return <span className="font-semibold tracking-wide text-black/60 uppercase dark:text-white/60">Halftime</span>;
  }
  if (game.status === "final") {
    return <span className="font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Final</span>;
  }
  if (game.status === "postponed" || game.status === "canceled") {
    return <span className="font-semibold tracking-wide text-red-500 uppercase">{game.status}</span>;
  }
  return <span className="font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Upcoming</span>;
}

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}
