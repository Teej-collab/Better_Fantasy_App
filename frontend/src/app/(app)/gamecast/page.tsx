import type { Metadata } from "next";
import { getNflScoreboard, type NflGame } from "@/lib/api";
import { TrackedGamecastLink } from "@/components/gamecast/TrackedGamecastLink";
import { findGamecastId, getLiveGames } from "@/lib/gamecastApi";
import { KickoffTime } from "@/components/gamecast/KickoffTime";

export const metadata: Metadata = { title: "Gamecast — Weekend League" };

type AnnotatedGame = NflGame & { gamecastId: string | null };
type Group = { title: string; games: AnnotatedGame[] };

/**
 * The persistent Gamecast hub — this week's real NFL slate (live,
 * upcoming, final), each game linking into its live Gamecast when one
 * exists. Before this page existed, a Gamecast link only ever appeared
 * transiently in the site ticker while a game was actually live
 * (withGamecastLinks, lib/gamecastApi.ts) — a flagship feature with no
 * persistent, browsable entry point outside that narrow window (a
 * finding from the 2026-08-31 competitive UX audit). Reuses the exact
 * same fetchers/matching logic the ticker already relies on
 * (getNflScoreboard, getLiveGames, findGamecastId) rather than adding
 * any new backend endpoint — this is purely a new view over data the
 * app already fetches elsewhere.
 */
export default async function GamecastHubPage() {
  const [nflGames, gamecastGames] = await Promise.all([getNflScoreboard(), getLiveGames()]);

  const annotated: AnnotatedGame[] = nflGames
    .filter((g) => g.home_team && g.away_team)
    .map((g) => ({ ...g, gamecastId: findGamecastId(g.home_team, g.away_team, gamecastGames) }));

  const groups: Group[] = [
    { title: "Live", games: annotated.filter((g) => g.state === "in") },
    { title: "Upcoming", games: annotated.filter((g) => g.state === "pre") },
    { title: "Final", games: annotated.filter((g) => g.state === "post") },
  ].filter((group) => group.games.length > 0);

  const week = annotated.find((g) => g.week !== null)?.week ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] font-bold tracking-widest uppercase" style={{ color: "var(--wl-live)" }}>
          Gamecast
        </span>
        <h1 className="font-display text-3xl font-semibold tracking-wide uppercase">NFL Games</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          Live scores{week !== null ? ` · Week ${week}` : ""}
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="wl-card flex flex-col items-center gap-2 p-8 text-center">
          <h2 className="text-lg font-semibold">No games scheduled right now</h2>
          <p className="text-sm text-black/50 dark:text-white/50">
            Gamecast lights up once real NFL games are on the slate — check back closer to kickoff.
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.title} className="flex flex-col gap-2.5">
            <h2 className="font-display text-xl font-semibold tracking-wide uppercase">{group.title}</h2>
            <div className="flex flex-col gap-2">
              {group.games.map((game) => (
                <GameRow key={game.id} game={game} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

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

function GameRow({ game }: { game: AnnotatedGame }) {
  const live = game.state === "in";
  const final = game.state === "post";
  const awayScore = Number(game.away_score ?? 0);
  const homeScore = Number(game.home_score ?? 0);

  const content = (
    <div className="wl-card flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span className="flex min-w-0 flex-col gap-1">
        <TeamLine abbr={game.away_team!} score={game.away_score} showScore={game.state !== "pre"} dim={final && awayScore < homeScore} />
        <TeamLine abbr={game.home_team!} score={game.home_score} showScore={game.state !== "pre"} dim={final && homeScore < awayScore} />
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
  // this week) still shows in the hub for a complete slate — it just
  // isn't a link, same convention withGamecastLinks already uses for
  // the ticker.
  if (!game.gamecastId) {
    return <div className="opacity-70">{content}</div>;
  }

  return (
    <TrackedGamecastLink
      gamecastId={game.gamecastId}
      href={`/gamecast/${game.gamecastId}`}
      className="block rounded-[0.875rem] transition-opacity hover:opacity-85 active:opacity-70"
    >
      {content}
    </TrackedGamecastLink>
  );
}
