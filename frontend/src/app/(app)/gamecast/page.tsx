import type { Metadata } from "next";
import { getNflScoreboard, type NflGame } from "@/lib/api";
import { NflGameRow } from "@/components/gamecast/NflGameRow";
import { findGamecastId, getLiveGames } from "@/lib/gamecastApi";

export const metadata: Metadata = { title: "Gamecast — The Weekend" };

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
                <NflGameRow key={game.id} game={game} gamecastId={game.gamecastId} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
