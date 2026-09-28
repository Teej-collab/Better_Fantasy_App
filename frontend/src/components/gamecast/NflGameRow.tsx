import type { NflGame } from "@/lib/api";
import { KickoffTime } from "@/components/gamecast/KickoffTime";
import { TrackedGamecastLink } from "@/components/gamecast/TrackedGamecastLink";

// One real NFL game as a card — away team stacked over home, each with
// its score, and the clock/kickoff and TV network on the right. Shared
// by the Gamecast hub (app/(app)/gamecast/page.tsx) and both homepage
// layouts' "Live Now" sections, so a game looks the same everywhere.

// ESPN's live shortDetail reads "8:42 - 2nd"; the broadcast-style
// "Q2 8:42" is easier to scan. Anything else (Halftime, End of 3rd,
// OT clocks) passes through unchanged.
function formatLiveStatus(detail: string | null): string {
  if (!detail) return "Live";
  const match = detail.match(/^(\d{1,2}:\d{2}) - (\d)(?:st|nd|rd|th)$/);
  return match ? `Q${match[2]} ${match[1]}` : detail;
}

function TeamLine({ abbr, score, showScore, dim }: { abbr: string; score: string | null; showScore: boolean; dim: boolean }) {
  return (
    <span className={`flex items-center gap-3 ${dim ? "text-black/45 dark:text-white/45" : ""}`}>
      <span className="w-10 font-semibold">{abbr}</span>
      {showScore && <span className="font-mono tabular-nums">{score ?? "0"}</span>}
    </span>
  );
}

export function NflGameRow({ game, gamecastId }: { game: NflGame; gamecastId: string | null }) {
  const live = game.state === "in";
  const final = game.state === "post";
  const awayScore = Number(game.away_score ?? 0);
  const homeScore = Number(game.home_score ?? 0);

  const content = (
    <div className="wl-card flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span className="flex min-w-0 flex-col gap-1">
        <TeamLine abbr={game.away_team ?? "—"} score={game.away_score} showScore={game.state !== "pre"} dim={final && awayScore < homeScore} />
        <TeamLine abbr={game.home_team ?? "—"} score={game.home_score} showScore={game.state !== "pre"} dim={final && homeScore < awayScore} />
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 text-right text-xs">
        {live ? (
          <span className="flex items-center gap-1.5 font-semibold" style={{ color: "var(--wl-live)" }}>
            <span className="live-dot" aria-hidden />
            {formatLiveStatus(game.status_detail)}
          </span>
        ) : final ? (
          <span className="text-black/60 dark:text-white/60">{game.status_detail ?? "Final"}</span>
        ) : (
          <span className="text-black/60 dark:text-white/60">
            <KickoffTime iso={game.date} fallback={game.status_detail ?? "Upcoming"} />
          </span>
        )}
        {game.broadcast && <span className="text-black/45 dark:text-white/45">{game.broadcast}</span>}
      </span>
    </div>
  );

  // A game with no Gamecast match (no live provider coverage for it
  // this week) still shows for a complete slate — it just isn't a
  // link, same convention withGamecastLinks already uses for the
  // ticker.
  if (!gamecastId) {
    return <div className="opacity-70">{content}</div>;
  }

  return (
    <TrackedGamecastLink
      gamecastId={gamecastId}
      href={`/gamecast/${gamecastId}`}
      className="block rounded-[0.875rem] transition-opacity hover:opacity-85 active:opacity-70"
    >
      {content}
    </TrackedGamecastLink>
  );
}
