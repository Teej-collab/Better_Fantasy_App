import type { Metadata } from "next";
import { getNflScoreboard, type NflGame } from "@/lib/api";
import { TrackedGamecastLink } from "@/components/gamecast/TrackedGamecastLink";
import { findGamecastId, getLiveGames } from "@/lib/gamecastApi";
import { NFL_TEAM_NAMES } from "@/lib/nfl-teams";

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
    { title: "Live now", games: annotated.filter((g) => g.state === "in") },
    { title: "Upcoming", games: annotated.filter((g) => g.state === "pre") },
    { title: "Final", games: annotated.filter((g) => g.state === "post") },
  ].filter((group) => group.games.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-wide uppercase">Gamecast</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Live play-by-play for real NFL games, tied back to your own fantasy matchup.
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="neon-panel flex flex-col items-center gap-2 rounded-xl p-8 text-center">
          <h2 className="text-lg font-semibold">No games scheduled right now</h2>
          <p className="text-sm text-black/50 dark:text-white/50">
            Gamecast lights up once real NFL games are on the slate — check back closer to kickoff.
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
              {group.title}
            </h2>
            <div className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg dark:divide-white/5">
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

function GameRow({ game }: { game: AnnotatedGame }) {
  const awayName = (game.away_team && NFL_TEAM_NAMES[game.away_team]) ?? game.away_team ?? "TBD";
  const homeName = (game.home_team && NFL_TEAM_NAMES[game.home_team]) ?? game.home_team ?? "TBD";

  const content = (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 truncate">
          {game.state === "in" && <span className="live-dot" aria-hidden />}
          {awayName} @ {homeName}
        </span>
        <span className="truncate text-xs text-black/50 dark:text-white/50">
          {game.status_detail ?? (game.state === "in" ? "Live" : game.state === "post" ? "Final" : "Upcoming")}
        </span>
      </span>
      {game.state !== "pre" && (
        <span className="shrink-0 tabular-nums text-black/70 dark:text-white/70">
          {game.away_score ?? "0"} – {game.home_score ?? "0"}
        </span>
      )}
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
      className="transition-colors hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10"
    >
      {content}
    </TrackedGamecastLink>
  );
}
